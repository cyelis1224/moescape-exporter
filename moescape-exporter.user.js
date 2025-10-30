// ==UserScript==
// @name         Tavern Chat Downloader
// @namespace    Holly
// @author       Holly
// @collaborator Dagyr
// @version      2.0.0
// @description  Preserve your Tavern conversations. Supports both Moescape and Yodayo.
// @match        https://yodayo.com/*
// @match        https://moescape.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=moescape.ai
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const QUERY_BATCH_SIZE = 500

    let imagePopup
    let imageViewerModal = null
    let chatCharacterPhotos = {} // Store character photos by chat UUID
    
    // Pagination state
    let currentPage = 1
    let pageSize = 20
    let totalImages = 0
    let filteredImages = []
    
    // Image viewer state
    let currentImageViewerIndex = 0
    let imageViewerImages = []
    
    // Site detection and color schemes
    const isMoescape = location.hostname.includes('moescape.ai')
    const isYodayo = location.hostname.includes('yodayo.com')
    
    // Color schemes based on site
    const colorScheme = isMoescape ? {
        // Moescape colors (darker, more purple-tinted)
        background: '#1a1c1e',           // Main background
        cardBackground: '#25282c',       // Card/entry backgrounds
        border: '#303439',               // Borders
        textPrimary: '#ffffff',          // Primary text
        textSecondary: '#E4F063',        // Secondary text
        hoverBackground: '#25282c',      // Hover backgrounds
        hoverText: '#E4F063',            // Hover text (green)
        gradient: '#E4F063',             // Green background
        accent: '#E4F063',               // Green accent
        glowColor: 'rgba(228, 240, 99, 0.3)' // Green glow for Moescape
    } : {
        // Yodayo colors (current scheme)
        background: '#151820',           // Main background
        cardBackground: '#374151',      // Card/entry backgrounds
        border: '#4b5563',              // Borders
        textPrimary: '#ffffff',         // Primary text
        textSecondary: '#f597E8',       // Secondary text
        hoverBackground: '#4b5563',     // Hover backgrounds
        hoverText: '#f597E8',           // Hover text (pink)
        gradient: '#f597E8',            // Pink background
        accent: '#a855f7',              // Purple accent
        glowColor: 'rgba(168, 85, 247, 0.3)' // Purple glow for Yodayo
    }

    // Add custom scrollbar styles
    const style = document.createElement('style')
    style.textContent = `
        /* Custom scrollbar for all elements */
        *::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        
        *::-webkit-scrollbar-track {
            background: transparent;
        }
        
        *::-webkit-scrollbar-thumb {
            background: ${colorScheme.border};
            border-radius: 4px;
        }
        
        *::-webkit-scrollbar-thumb:hover {
            background: ${colorScheme.cardBackground};
        }
    `
    document.head.appendChild(style)

    // Optional: tiny progress HUD (add once, reuse)
    function makeHud() {
        const hud = document.createElement('div');
        Object.assign(hud.style, {
            position:'fixed', right:'12px', bottom:'12px', zIndex: 999999,
            background:'rgba(20,20,28,.9)', color:'#fff', padding:'8px 10px',
            borderRadius:'10px', font:'12px/1.35 system-ui, sans-serif'
        });
        hud.textContent = '…';
        document.body.appendChild(hud);
        return {
            set: s => hud.textContent = s,
            remove: () => hud.remove()
        };
    }

    // Function to trigger the exporter
    function triggerExporter() {
        // If we're on a chat page, capture the current chat UUID for filtering
        try {
            const m = location.pathname.match(/\/tavern\/chat\/([a-f0-9\-]+)/i)
            if (m && m[1]) {
                window.hollyCurrentChatUuid = m[1]
            } else {
                window.hollyCurrentChatUuid = null
            }
        } catch (_) {
            window.hollyCurrentChatUuid = null
        }
        // Create a temporary link element to use with retrieveChatsChunk
        const tempLink = document.createElement('a')
        tempLink.style.display = 'none'
        document.body.appendChild(tempLink)
        
        if (tempLink.busy) {
            console.log('Exporter already busy')
            return
        }
        tempLink.busy = true
        retrieveChatsChunk(0, [], tempLink)
    }

    // Function to add exporter option to chat settings menu
    function addExporterToChatMenu() {
        // Look for the Headless UI menu items container
        const menuContainer = document.querySelector('[id^="headlessui-menu-items"]')
        if (!menuContainer) return false
        
        // Check if we already added the exporter option (but allow re-adding if menu was recreated)
        const existingExporter = menuContainer.querySelector('#holly-exporter-menu-item')
        if (existingExporter) {
            // Item exists, make sure it's still in the right place
            const itemsArray = Array.from(menuContainer.querySelectorAll('[role="menuitem"]'))
            const allChatsIndex = itemsArray.findIndex(item => 
                item.textContent.trim().toLowerCase().includes('all chats') || 
                item.textContent.trim().toLowerCase().includes('all chat')
            )
            const exporterIndex = itemsArray.findIndex(item => item.id === 'holly-exporter-menu-item')
            
            // If exporter is not right after "All Chats", remove and re-insert it
            if (allChatsIndex >= 0 && exporterIndex !== allChatsIndex + 1) {
                existingExporter.remove()
            } else {
                return false // Already in correct position
            }
        }
        
        // Find all existing menu items to understand the structure
        const existingItems = menuContainer.querySelectorAll('[role="menuitem"]')
        if (existingItems.length === 0) return false
        
        // Find "All Chats" item to use as a template (it has an icon)
        let allChatsTemplate = null
        for (let item of existingItems) {
            const text = item.textContent.trim().toLowerCase()
            if (text.includes('all chats') || text.includes('all chat')) {
                allChatsTemplate = item
                break
            }
        }
        
        // Use "All Chats" as template if found, otherwise use first item with icon or just first item
        let templateItem = allChatsTemplate
        if (!templateItem) {
            for (let item of existingItems) {
                if (item.querySelector('svg')) {
                    templateItem = item
                    break
                }
            }
        }
        if (!templateItem) {
            templateItem = existingItems[0]
        }
        
        // Clone the template item to match the structure and styling exactly
        const exporterItem = templateItem.cloneNode(true)
        exporterItem.id = 'holly-exporter-menu-item'
        
        // Remove any existing headlessui id attribute
        if (exporterItem.id) {
            exporterItem.id = 'holly-exporter-menu-item'
        }
        
        // Create the download icon SVG
        const downloadIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`
        
        // Replace the icon if one exists, or add it
        const existingIcon = exporterItem.querySelector('svg')
        
        if (existingIcon) {
            // Replace just the SVG content, preserving harnessing wrapper
            const wrapper = existingIcon.parentElement
            const wrapperClasses = wrapper ? wrapper.className : ''
            
            // Create new SVG element with proper namespace
            const newIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            newIcon.setAttribute('width', '24')
            newIcon.setAttribute('height', '24')
            newIcon.setAttribute('viewBox', '0 0 24 24')
            newIcon.setAttribute('fill', 'none')
            newIcon.setAttribute('stroke', 'currentColor')
            newIcon.setAttribute('stroke-width', '2')
            newIcon.setAttribute('stroke-linecap', 'round')
            newIcon.setAttribute('stroke-linejoin', 'round')
            
            // Add path elements
            const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path1.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4')
            newIcon.appendChild(path1)
            
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
            polyline.setAttribute('points', '7,10 12,15 17,10')
            newIcon.appendChild(polyline)
            
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
            line.setAttribute('x1', '12')
            line.setAttribute('y1', '15')
            line.setAttribute('x2', '12')
            line.setAttribute('y2', '3')
            newIcon.appendChild(line)
            
            // Preserve wrapper if it exists, otherwise replace directly
            if (wrapper && wrapper !== exporterItem) {
                wrapper.innerHTML = ''
                wrapper.appendChild(newIcon)
                wrapper.className = wrapperClasses
            } else {
                existingIcon.parentNode.replaceChild(newIcon, existingIcon)
            }
        } else {
            // If no icon found, add one at the beginning
            // Look for where icons typically go (first child or specific container)
            const firstChild = exporterItem.firstElementChild
            if (firstChild && firstChild.classList.contains('flex')) {
                firstChild.insertAdjacentHTML('afterbegin', downloadIcon)
                const inserted = firstChild.querySelector('svg')
                if (inserted) {
                    inserted.style.width = '24px'
                    inserted.style.height = '24px'
                    inserted.setAttribute('width', '24')
                    inserted.setAttribute('height', '24')
                }
            } else {
                exporterItem.insertAdjacentHTML('afterbegin', downloadIcon)
                const inserted = exporterItem.querySelector('svg')
                if (inserted) {
                    inserted.style.width = '24px'
                    inserted.style.height = '24px'
                    inserted.setAttribute('width', '24')
                    inserted.setAttribute('height', '24')
                }
            }
        }
        
        // Replace the text content - since we cloned from "All Chats", replace that text
        const textToReplace = 'All Chats'
        const newText = 'Export Chat/Images'
        
        // Find and replace text nodes, preserving the SVG icon
        // Don't use textContent as it removes the SVG - use TreeWalker instead
        const walker = document.createTreeWalker(
            exporterItem,
            NodeFilter.SHOW_TEXT,
            null,
            false
        )
        
        let node
        while (node = walker.nextNode()) {
            const text = node.textContent.trim()
            // Skip empty text nodes - we want to find actual text content
            if (text && text.length > 0) {
                // Replace "All Chats" with "Export Chat"
                if (text.toLowerCase().includes('all chats') || text.toLowerCase().includes('all chat')) {
                    node.textContent = text.replace(/All Chats?/i, newText)
                } else if (text && !node.parentElement.querySelector('svg')) {
                    // If this is text not inside an SVG container, replace it
                    node.textContent = newText
                }
                // Only replace the first meaningful text node
                break
            }
        }
        
        // Ensure proper attributes (should already be set from clone, but make sure)
        exporterItem.setAttribute('role', 'menuitem')
        exporterItem.setAttribute('tabindex', '-1')
        
        // Ensure left alignment by matching other menu items' structure
        const textElements = exporterItem.querySelectorAll('span, div')
        textElements.forEach(el => {
            if (!el.querySelector('svg') && el.textContent.trim()) {
                el.style.textAlign = 'left'
            }
        })

        // Hover highlight to match native menu behavior
        exporterItem.addEventListener('mouseenter', function () {
            this.style.backgroundColor = '#FFFFFF33'
        })
        exporterItem.addEventListener('mouseleave', function () {
            this.style.backgroundColor = ''
        })
        
        // Add click handler
        exporterItem.addEventListener('click', function(e) {
            e.preventDefault()
            e.stopPropagation()
            
            // Close the menu first (trigger click on menu button)
            const menuButton = document.querySelector('[id^="headlessui-menu-button"]')
            if (menuButton) {
                menuButton.click()
            }
            
            // Small delay to let menu close
            setTimeout(() => {
                triggerExporter()
            }, 150)
        })
        
        // Find "All Chats" menu item and insert after it
        let allChatsItem = null
        let allChatsIndex = -1
        
        // Convert NodeList to array for easier manipulation
        const itemsArray = Array.from(existingItems)
        
        for (let i = 0; i < itemsArray.length; i++) {
            const item = itemsArray[i]
            const text = item.textContent.trim().toLowerCase()
            if (text.includes('all chats') || text.includes('all chat')) {
                allChatsItem = item
                allChatsIndex = i
                break
            }
        }
        
        if (allChatsItem) {
            // Insert immediately after "All Chats" BUT before the divider that follows it
            // This keeps it in the same group as "All Chats"
            const dividerOrNext = allChatsItem.nextElementSibling
            if (dividerOrNext) {
                allChatsItem.parentNode.insertBefore(exporterItem, dividerOrNext)
            } else {
                allChatsItem.insertAdjacentElement('afterend', exporterItem)
            }
        } else {
            // Fallback: insert after existing items (add to the end)
            menuContainer.appendChild(exporterItem)
        }
        
        return true
    }

    window.addEventListener('load', function ()
        {
        setInterval(function ()
            {
            if (!location.href.startsWith('https://' + location.hostname + '/tavern'))
                return

            let btn = document.getElementById('holly_download_button')
            if (!btn)
                {
                console.log('checking')
                // Look for the header div that contains Create and Guides buttons
                let headerRightDiv = document.querySelector('nav.sticky > div.flex > div.flex:last-child')
                if (!headerRightDiv)
                    return

                btn = document.createElement('div')
                btn.setAttribute('id', 'holly_download_button')
                btn.className = 'flex flex-col items-center justify-start text-secondaryText'
                btn.innerHTML = '<div class="flex items-center gap-1.5"><a class="text-secondaryText"><div class="flex items-center gap-2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span class="whitespace-nowrap text-sm font-semibold sm:text-base">Export Chat/Images</span></div></a></div><div class="h-[0px] w-full border border-primaryBtn invisible"></div>'
                let link = btn.querySelector('a')
                link.style.cursor = 'pointer'
                link.style.transition = 'color 0.2s'
                link.style.color = '#FFFFFF'
                // Ensure the SVG is 24x24 regardless of site CSS
                const headerSvg = btn.querySelector('svg')
                if (headerSvg) {
                    headerSvg.style.width = '20px'
                    headerSvg.style.height = '20px'
                    headerSvg.setAttribute('width', '20')
                    headerSvg.setAttribute('height', '20')
                }
                link.addEventListener('mouseenter', function() { this.style.color = colorScheme.hoverText; })
                link.addEventListener('mouseleave', function() { this.style.color = '#FFFFFF'; })
                link.addEventListener('click', function ()
                    {
                    if (link.busy)
                        {
                        console.log('Button click ignored - already busy')
                        return
                        }

                    link.busy = true
                    // Update the text while preserving the SVG icon
                    const textSpan = link.querySelector('span')
                    if (textSpan) {
                        textSpan.textContent = '(Processing ...)'
                    }
                    // Opening from the global header: clear any prior chat-specific filter
                    try { window.hollyCurrentChatUuid = null } catch (_) {}
                    retrieveChatsChunk(0, [], link)
                    })

                headerRightDiv.insertBefore(btn, headerRightDiv.firstChild)
                }
            
            // Try to add exporter to chat settings menu (only on chat pages)
            if (location.href.includes('/tavern/chat/')) {
                addExporterToChatMenu()
            }

            }, 1000)
        
        // Also watch for menu dynamically opening using MutationObserver
        const observer = new MutationObserver(function(mutations) {
            if (location.href.includes('/tavern/chat/')) {
                addExporterToChatMenu()
            }
        })
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        })
        })

    function retrieveChatsChunk(offset, collected, btn)
        {
        ajax('https://api.' + location.hostname + '/v1/chats?limit=' + QUERY_BATCH_SIZE + '&offset=' + offset, false, function (r)
            {
            r = JSON.parse(r)
            if (!r || r.error)
                return

            let cleanChats = r.chats.map(function (chat)
                {
                return {
                    uuid: chat.uuid,
                    name: chat.name,
                    date: chat.created_at,
                    chars: chat.characters.map(function (char)
                        {
                        return {
                            name: char.name,
                            uuid: char.uuid,
                            photos: {
                                thumbnail: char.thumbnail_photo?.url,
                                foreground: char.photos.map(function (photo) {return photo.url}),
                                background: char.background_photos.map(function (photo) {return photo.url}),
                                }
                            }
                        })
                    }
                })

            collected = collected.concat(cleanChats)

            if (r.chats.length == QUERY_BATCH_SIZE)
                retrieveChatsChunk(offset + QUERY_BATCH_SIZE, collected, btn)
            else
                {
                btn.busy = false
                // Reset the button text while preserving the SVG icon
                const textSpan = btn.querySelector('span')
                if (textSpan) {
                    textSpan.textContent = 'Export Chat/Images'
                }

                // If we launched from a chat page, filter chats to only those with the same character(s)
                let toShow = collected
                try {
                    if (window.hollyCurrentChatUuid) {
                        const current = collected.find(c => c.uuid === window.hollyCurrentChatUuid)
                        if (current && current.chars && current.chars.length) {
                            const targetCharUuids = new Set(current.chars.map(c => c.uuid).filter(Boolean))
                            if (targetCharUuids.size > 0) {
                                toShow = collected.filter(chat => (chat.chars || []).some(ch => targetCharUuids.has(ch.uuid)))
                            }
                        }
                    }
                } catch (_) {}

                // Store the list that will actually be rendered so indices match
                window.currentChats = toShow

                if (toShow.length > 0)
                    showChatsToDownload(toShow)
                else
                    alert('Unable to find any chats.')
                }
            })
        }

    function showChatsToDownload(chats)
        {
        var cover = document.createElement('div')
        cover.style.cssText = 'background-color: rgba(0, 0, 0, 0); position: fixed; top: 0; bottom: 0; left: 0; right: 0; z-index: 110; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); transition: background-color 0.3s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease;'

        let popup = document.createElement('div')
        popup.style.cssText = `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); width: 90vw; max-width: 1400px; height: fit-content;max-height: 85vh; scroll: auto; background-color: ${colorScheme.background}; border-radius: 16px; padding: clamp(16px, 3vw, 32px); display: flex; flex-direction: column; border: 1px solid ${colorScheme.border}; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease;`

        // Build dynamic title
        let titleText = `Your Chats`
        try {
            if (window.hollyCurrentChatUuid) {
                // Prefer exact match; otherwise use the first chat if all are filtered to same character(s)
                const exact = chats.find(c => c.uuid === window.hollyCurrentChatUuid)
                const source = exact || (chats.length ? chats[0] : null)
                if (source && Array.isArray(source.chars) && source.chars.length) {
                    const nameList = source.chars.map(c => c.name).join(', ')
                    if (nameList) titleText = `Your chats with ${nameList}`
                }
            }
        } catch (_) {}

        popup.innerHTML = `<h2 title="${titleText} (${chats.length})" style="display:block; font-size: clamp(20px, 5vw, 32px); line-height: 1.2; padding-top: 4px; background: ${colorScheme.textSecondary}; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-weight: bold; margin-bottom: clamp(10px, 2vw, 20px); white-space: nowrap; overflow: visible; text-overflow: ellipsis; max-width: calc(100% - 64px); padding-right: 16px;">${titleText} (${chats.length})</h2>`
        cover.appendChild(popup)

        // Function to close the modal
        const closeModal = function () {
            // Start closing animation
            cover.style.backgroundColor = 'rgba(0, 0, 0, 0)'
            cover.style.backdropFilter = 'blur(0px)'
            cover.style.webkitBackdropFilter = 'blur(0px)'
            popup.style.opacity = '0'
            popup.style.transform = 'translate(-50%, -50%) scale(0.95)'
            
            // Remove from DOM after animation
            setTimeout(() => {
                if (cover && cover.parentNode) {
                    cover.parentNode.removeChild(cover)
                }
            }, 300)
        }
        
        let closeButton = document.createElement('button')
        closeButton.innerText = 'X'
        closeButton.addEventListener('click', closeModal)
        closeButton.style.cssText = `position: absolute; top: clamp(12px, 2vw, 24px); right: clamp(12px, 2vw, 24px); background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; padding: clamp(6px, 1.5vw, 8px) clamp(12px, 3vw, 16px); border-radius: 8px; border: none; cursor: pointer; font-weight: 500; transition: background-color 0.2s; font-size: clamp(12px, 3vw, 14px);`
        closeButton.addEventListener('mouseenter', function() { this.style.backgroundColor = colorScheme.hoverBackground; })
        closeButton.addEventListener('mouseleave', function() { this.style.backgroundColor = colorScheme.cardBackground; })
        popup.appendChild(closeButton)

        // Controls row (format + sort)
        const controlsRow = document.createElement('div')
        controlsRow.style.cssText = 'display: flex; gap: 12px; align-items: center; margin-bottom: 0px; flex-wrap: wrap;'

        let formatSelect = document.createElement('select')
        formatSelect.setAttribute('id', 'holly_download_format')
        formatSelect.style.cssText = `width: 260px; font-weight: 500; margin-bottom: 20px; background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 8px; padding: 8px 12px; font-size: 14px;`
        for (const [key, value] of Object.entries({
            'txt': 'Download as TXT',
            'jsonl-st': 'Download as JSONL (SillyTavern)',
            'jsonl-openai': 'Download as JSONL (OpenAI-Template)',
            'json': 'Download as full JSON'
            }))
            {
            let option = document.createElement('option')
            option.setAttribute('value', key)
            option.innerText = value
            formatSelect.appendChild(option)
            }

        // We'll place the format selector at the bottom footer instead of top controls

        // Sort dropdown
        const sortSelect = document.createElement('select')
        sortSelect.id = 'holly_sort_chats'
        sortSelect.style.cssText = `width: 220px; font-weight: 500; margin-bottom: 12px; background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 8px; padding: 8px 12px; font-size: 14px;`
        ;
        ;
        ;
        ;
        const sortOptions = [
            { value: 'date_desc', label: 'Sort: Date (Newest first)' },
            { value: 'date_asc', label: 'Sort: Date (Oldest first)' },
            { value: 'name_asc', label: 'Sort: Name (A–Z)' },
            { value: 'name_desc', label: 'Sort: Name (Z–A)' },
            { value: 'chars_asc', label: 'Sort: Character (A–Z)' }
        ]
        sortOptions.forEach(o => {
            const opt = document.createElement('option')
            opt.value = o.value
            opt.textContent = o.label
            sortSelect.appendChild(opt)
        })
        // Search input (Moescape-like)
        const searchWrap = document.createElement('div')
        searchWrap.className = 'holly-searchbar-wrap'
        searchWrap.style.cssText = `display: flex; align-items: center; gap: 8px; width: clamp(200px, 40vw, 420px); max-width: 40%; min-width: 410px; width: -webkit-fill-available; margin-bottom: 12px; background: ${colorScheme.cardBackground}; border: 1px solid ${colorScheme.border}; border-radius: 10px; padding: 8px 12px; transition: border-color .15s ease, box-shadow .15s ease;`
        
        // Add responsive styles for mobile
        if (!document.getElementById('holly-searchbar-responsive')) {
            const searchBarResponsive = document.createElement('style')
            searchBarResponsive.id = 'holly-searchbar-responsive'
            searchBarResponsive.textContent = `
                @media (max-width: 768px) {
                    .holly-searchbar-wrap {
                        min-width: 0 !important;
                        max-width: 100% !important;
                        width: 100% !important;
                        box-sizing: border-box !important;
                    }
                }
            `
            document.head.appendChild(searchBarResponsive)
        }
        
        const searchIcon = document.createElement('span')
        searchIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${colorScheme.textPrimary};opacity:.9"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`
        const searchInput = document.createElement('input')
        searchInput.type = 'text'
        searchInput.placeholder = 'Search'
        searchInput.style.cssText = `flex:1; background: transparent; color: ${colorScheme.textPrimary}; border: none; outline: none; font-size: 14px; caret-color: ${colorScheme.hoverText};`
        searchWrap.appendChild(searchIcon)
        searchWrap.appendChild(searchInput)
        // Add search first, then sort
        controlsRow.appendChild(searchWrap)
        controlsRow.appendChild(sortSelect)

        // Focus styles for search (border highlight based on site theme)
        searchInput.addEventListener('focus', function(){
            searchWrap.style.borderColor = colorScheme.hoverText
            searchWrap.style.boxShadow = `0 0 0 2px ${colorScheme.glowColor}`
            const svg = searchIcon.querySelector('svg')
            if (svg) svg.style.color = colorScheme.hoverText
        })
        searchInput.addEventListener('blur', function(){
            searchWrap.style.borderColor = colorScheme.border
            searchWrap.style.boxShadow = 'none'
            const svg = searchIcon.querySelector('svg')
            if (svg) svg.style.color = colorScheme.textSecondary
        })

        popup.appendChild(controlsRow)

        let list = document.createElement('ul')
        list.style.cssText = 'overflow: auto; padding-right: 8px;'
        
        // Keep copies and state for search/sort
        let originalChats = chats.slice()
        let workingChats = chats.slice()
        let currentSort = 'date_desc'
        let currentSearch = ''

        function renderChatList() {
            // Keep global reference aligned with current rendered order for image lookups
            try { window.currentChats = workingChats } catch (_) {}
            list.innerHTML = ''
            for (let i = 0; i < workingChats.length; i++)
                {
                const chatData = workingChats[i]
                let chatEntry = document.createElement('li')
            chatEntry.style.cssText = `margin: 8px 0; padding: 12px; display: flex; flex-direction: column; gap: 12px; border-bottom: solid 1px ${colorScheme.border}; position: relative; background: ${colorScheme.cardBackground}; border-radius: 8px; transition: background-color 0.2s;`
            chatEntry.addEventListener('mouseenter', function() { this.style.backgroundColor = colorScheme.hoverBackground; })
            chatEntry.addEventListener('mouseleave', function() { this.style.backgroundColor = colorScheme.cardBackground; })

            // Create top row container for name/date and icons
            let topRowContainer = document.createElement('div')
            topRowContainer.style.cssText = 'display: flex; align-items: center; gap: 12px; justify-content: space-between;'
            
            // Create character icons container
            let charIconsContainer = document.createElement('div')
            const numChars = chatData.chars.length
            // On desktop: single row, on mobile: wrap with max 2 columns
            charIconsContainer.style.cssText = `display: grid; grid-template-columns: repeat(${numChars}, auto); gap: 8px; min-width: fit-content; flex-shrink: 0; margin-bottom: -50px; align-items: center;`
            
            // Add responsive styles for mobile
            const style = document.createElement('style')
            if (!document.getElementById('char-icons-responsive-style')) {
                style.id = 'char-icons-responsive-style'
                style.textContent = `
                    @media (max-width: 768px) {
                        .char-icons-container-multiple {
                            grid-template-columns: repeat(2, 56px) !important;
                            max-width: calc(100vw - 100px);
                            justify-content: start;
                            grid-auto-rows: 56px;
                        }
                        .char-icons-container-multiple .char-icon-mobile {
                            width: 56px !important;
                            height: 56px !important;
                        }
                    }
                `
                document.head.appendChild(style)
            }
            
            // Add class to identify containers with multiple characters
            if (numChars > 1) {
                charIconsContainer.className = 'char-icons-container char-icons-container-multiple'
            } else {
                charIconsContainer.className = 'char-icons-container'
            }
            
            // Add character icons
            chatData.chars.forEach(function(char, charIndex) {
                // Create clickable link wrapper
                let charLink = document.createElement('a')
                // Use different URL formats for different sites
                if (isMoescape) {
                    charLink.href = `https://moescape.ai/tavern/characters/${char.uuid}`
                } else {
                    charLink.href = `https://yodayo.com/tavern/characters/${char.uuid}`
                }
                charLink.target = '_blank'
                charLink.style.cssText = 'text-decoration: none; cursor: pointer;'
                charLink.title = `View ${char.name}'s profile`
                
                let charIcon = document.createElement('div')
                // Fixed size for all icons on desktop, will shrink on mobile via CSS
                const iconSize = '80px'
                charIcon.style.cssText = `width: ${iconSize}; height: ${iconSize}; border-radius: 50%; border: 2px solid ${colorScheme.border}; overflow: hidden; flex-shrink: 0; background: ${colorScheme.cardBackground}; display: flex; align-items: center; justify-content: center; transition: transform 0.2s, box-shadow 0.2s;`
                charIcon.className = 'char-icon-mobile'
                charIcon.title = char.name
                
                // Add hover effect
                charLink.addEventListener('mouseenter', function() {
                    charIcon.style.transform = 'scale(1.05)'
                    charIcon.style.boxShadow = `0 4px 12px ${colorScheme.glowColor}`
                })
                charLink.addEventListener('mouseleave', function() {
                    charIcon.style.transform = 'scale(1)'
                    charIcon.style.boxShadow = 'none'
                })
                
                if (char.photos && char.photos.thumbnail) {
                    // Use thumbnail photo if available
                    charIcon.innerHTML = `<img src="${char.photos.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;">`
                } else if (char.photos && char.photos.foreground && char.photos.foreground.length > 0) {
                    // Fallback to first foreground photo if no thumbnail
                    charIcon.innerHTML = `<img src="${char.photos.foreground[0]}" style="width: 100%; height: 100%; object-fit: cover;">`
                }
                // If no photos available, leave the icon empty (just the background)
                
                charLink.appendChild(charIcon)
                charIconsContainer.appendChild(charLink)
            })
            
            // Create container for name and date
            let nameDateContainer = document.createElement('div')
            nameDateContainer.style.cssText = 'display: flex; flex-direction: column; flex: 1; gap: 4px;'

            // Create clickable link for the chat name
            let charsLink = document.createElement('a')
            charsLink.href = chatData.uuid ? (isMoescape ? `https://moescape.ai/tavern/chat/${chatData.uuid}` : `https://yodayo.com/tavern/chat/${chatData.uuid}`) : '#'
            charsLink.target = '_blank'
            charsLink.style.cssText = `color: ${colorScheme.textPrimary}; font-weight: 500; font-size: 14px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; cursor: pointer; text-decoration: none;`
            charsLink.innerHTML = chatData.chars.map(function (char) {return char.name}).join(', ')
            // Add hover effect
            charsLink.addEventListener('mouseenter', function() { this.style.color = colorScheme.hoverText; })
            charsLink.addEventListener('mouseleave', function() { this.style.color = colorScheme.textPrimary; })
            nameDateContainer.appendChild(charsLink)

            let dateLabel = document.createElement('label')
            dateLabel.style.cssText = `white-space: nowrap; color: ${colorScheme.textSecondary}; font-size: 12px;`
            dateLabel.innerHTML = chatData.date.substr(0, 10)
            nameDateContainer.appendChild(dateLabel)

            topRowContainer.appendChild(nameDateContainer)
            topRowContainer.appendChild(charIconsContainer)

            chatEntry.appendChild(topRowContainer)

            // Create button container
            let buttonContainer = document.createElement('div')
            buttonContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; flex-shrink: 0;'

            let downloadButton = document.createElement('button')
            downloadButton.innerText = 'Download'
            downloadButton.style.cssText = `background: ${colorScheme.gradient}; color: black; padding: clamp(8px, 2vw, 10px) clamp(12px, 3vw, 16px); border-radius: 8px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s; font-size: clamp(12px, 3vw, 14px); min-width: 80px;`
            downloadButton.addEventListener('mouseenter', function() { this.style.background = isYodayo ? '#151820' : '#1A1C1E'; })
            downloadButton.addEventListener('mouseenter', function() { this.style.color = colorScheme.hoverText; })
            downloadButton.addEventListener('mouseleave', function() { this.style.background = colorScheme.gradient; })
            downloadButton.addEventListener('mouseleave', function() { this.style.color = 'black'; })
            downloadButton.addEventListener('click', function ()
                {
                closeImagePopup()

                if (downloadButton.busy)
                    {
                    console.log('Button click ignored - already busy')
                    return
                    }

                downloadButton.busy = true
                downloadButton.innerText = '(Processing...)'
                downloadButton.style.background = '#6b7280'

                let uuid = chatData.uuid
                retrieveConversationChunk(uuid, 0, [], downloadButton)
                })
            buttonContainer.appendChild(downloadButton)

            let photoButton = document.createElement('button')
            photoButton.innerText = 'Images'
            photoButton.style.cssText = `background: ${colorScheme.gradient}; color: black; padding: clamp(8px, 2vw, 10px) clamp(12px, 3vw, 16px); border-radius: 8px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s; font-size: clamp(12px, 3vw, 14px); min-width: 80px;`
            photoButton.addEventListener('mouseenter', function() { this.style.background = isYodayo ? '#151820' : '#1A1C1E'; })
            photoButton.addEventListener('mouseenter', function() { this.style.color = colorScheme.hoverText; })
            photoButton.addEventListener('mouseleave', function() { this.style.background = colorScheme.gradient; })
            photoButton.addEventListener('mouseleave', function() { this.style.color = 'black'; })
            photoButton.addEventListener('click', function ()
                {
                if (photoButton.busy)
                    {
                    console.log('Images button click ignored - already busy')
                    return
                    }

                photoButton.busy = true
                photoButton.innerText = '(Loading...)'
                photoButton.style.background = '#6b7280'

                let uuid = chatData.uuid
                retrieveConversationChunk(uuid, 0, [], photoButton, i)
                })
            buttonContainer.appendChild(photoButton)

            chatEntry.appendChild(buttonContainer)

            list.appendChild(chatEntry)
            }
        }

        // Recompute from original -> filter -> sort -> render
        function recomputeList() {
            // Filter by search
            const q = currentSearch
            let filtered = originalChats
            if (q) {
                filtered = originalChats.filter(chat => {
                    const name = (chat.name || '')
                    const chars = (chat.chars || []).map(c => c.name).join(' ')
                    return (name + ' ' + chars).toLowerCase().includes(q)
                })
            }
            // Apply sort
            workingChats = filtered.slice()
            switch (currentSort) {
                case 'date_asc':
                    workingChats.sort((a,b)=> new Date(a.date) - new Date(b.date));
                    break
                case 'name_asc':
                    workingChats.sort((a,b)=> a.chars.map(c=>c.name).join(', ').localeCompare(b.chars.map(c=>c.name).join(', ')))
                    break
                case 'name_desc':
                    workingChats.sort((a,b)=> b.chars.map(c=>c.name).join(', ').localeCompare(a.chars.map(c=>c.name).join(', ')))
                    break
                case 'chars_asc':
                    workingChats.sort((a,b)=> (a.chars[0]?.name||'').localeCompare(b.chars[0]?.name||''))
                    break
                case 'date_desc':
                default:
                    workingChats.sort((a,b)=> new Date(b.date) - new Date(a.date));
                    break
            }
            try { window.currentChats = workingChats } catch (_) {}
            renderChatList()
        }

        // Initial render
        recomputeList()

        // Sorting behavior
        function applySort(value) {
            currentSort = value
            recomputeList()
        }
        sortSelect.addEventListener('change', function(){ applySort(this.value) })

        // Hook up search
        searchInput.addEventListener('input', function(){
            currentSearch = (this.value || '').trim().toLowerCase()
            recomputeList()
        })

        popup.appendChild(list)

        // Bottom footer with format selector
        const footer = document.createElement('div')
        footer.style.cssText = `display: flex; justify-content: flex-start; align-items: center; gap: 12px; padding-top: 12px; border-top: 1px solid ${colorScheme.border}; margin-top: 8px; align-items: baseline;`
        const formatLabel = document.createElement('span')
        formatLabel.textContent = 'Download format:'
        formatLabel.style.cssText = `color: ${colorScheme.textSecondary}; font-size: 12px;`
        footer.appendChild(formatLabel)
        footer.appendChild(formatSelect)
        popup.appendChild(footer)
        document.body.appendChild(cover)
        
        // Add ESC key listener
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                // Check if image popup is open first
                if (imagePopup && imagePopup.parentNode && document.querySelector('#images-grid')) {
                    closeImagePopup()
                } else {
                    closeModal()
                    document.removeEventListener('keydown', escHandler)
                }
            }
        }
        document.addEventListener('keydown', escHandler)
        
        // Add backdrop click handler
        cover.addEventListener('click', function(e) {
            // Only close if clicking the backdrop itself, not the popup
            if (e.target === cover) {
                closeModal()
            }
        })
        
        // Trigger animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                cover.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
                cover.style.backdropFilter = 'blur(4px)'
                cover.style.webkitBackdropFilter = 'blur(4px)'
                popup.style.opacity = '1'
                popup.style.transform = 'translate(-50%, -50%) scale(1)'
            })
        })
        }

    function closeImagePopup()
        {
        // Start closing animation
        if (imagePopup && imagePopup.parentNode)
            {
            imagePopup.style.opacity = '0'
            imagePopup.style.transform = 'translate(-50%, -50%) scale(0.95)'
            
            // Remove from DOM after animation
            setTimeout(() => {
                if (imagePopup && imagePopup.parentNode) {
                    imagePopup.parentNode.removeChild(imagePopup)
                    imagePopup = null
                }
            }, 300)
            }

        // Remove backdrop if it exists - search by z-index and style pattern
        const backdrop = document.querySelector('div[style*="position: fixed"][style*="z-index: 999998"]')
        if (backdrop) {
            backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0)'
            backdrop.style.backdropFilter = 'blur(0px)'
            backdrop.style.webkitBackdropFilter = 'blur(0px)'
            
            // Remove from DOM after animation
            setTimeout(() => {
                if (backdrop && backdrop.parentNode) {
                    backdrop.remove()
                }
            }, 300)
        }
        }

    function showImageViewer(imageData, index) {
        // Remove any previous keydown handler to prevent event stacking
        if (window.hollyImageViewerKeyHandler) {
            document.removeEventListener('keydown', window.hollyImageViewerKeyHandler, true)
            window.hollyImageViewerKeyHandler = null
        }

        // Store the image list and current index
        imageViewerImages = filteredImages
        currentImageViewerIndex = index

        // Close any existing viewer
        closeImageViewer()

        // Create backdrop overlay
        const backdrop = document.createElement('div')
        backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0); z-index: 1000000; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); transition: background-color 0.3s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease; cursor: pointer;'
        backdrop.onclick = closeImageViewer
        document.body.appendChild(backdrop)

        // Create modal container
        imageViewerModal = document.createElement('div')
        imageViewerModal.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.9); z-index: 1000001; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease; max-width: 95vw; max-height: 95vh;`
        document.body.appendChild(imageViewerModal)

        // Create content container for proper positioning
        const contentContainer = document.createElement('div')
        contentContainer.style.cssText = 'position: relative; max-width: 95vw; max-height: 95vh; display: flex; align-items: center; justify-content: center;'
        imageViewerModal.appendChild(contentContainer)

        // Navigation function
        const showImageAtIndex = (idx) => {
            if (idx < 0 || idx >= imageViewerImages.length) return
            currentImageViewerIndex = idx
            
            // Check if this image is on a different page in the image popup
            const imagePage = Math.floor(idx / pageSize) + 1
            if (imagePage !== currentPage) {
                currentPage = imagePage
                displayCurrentPage()
                updatePaginationControls()
            }
            
            const img = imageViewerModal.querySelector('img')
            const metadata = imageViewerModal.querySelector('.image-metadata')
            const messageDiv = metadata.querySelector('.metadata-message')
            const timestampDiv = metadata.querySelector('.metadata-timestamp')
            const modelDiv = metadata.querySelector('.metadata-model')
            const leftArrow = document.querySelector('.image-viewer-arrow-left')
            const rightArrow = document.querySelector('.image-viewer-arrow-right')
            
            // Fade out
            img.style.opacity = '0'
            metadata.style.opacity = '0'
            
            setTimeout(() => {
                img.src = imageViewerImages[idx].url
                messageDiv.textContent = imageViewerImages[idx].message
                timestampDiv.textContent = new Date(imageViewerImages[idx].timestamp).toLocaleString()
                
                if (modelDiv) {
                    modelDiv.textContent = imageViewerImages[idx].model || 'Unknown Model'
                }
                
                // Remove old expandable section if it exists
                const oldExpandToggle = metadata.querySelector('div[style*="cursor: pointer"]')
                const oldDetailsSection = metadata.querySelector('.metadata-details')
                if (oldExpandToggle && oldExpandToggle.parentNode === metadata) oldExpandToggle.remove()
                if (oldDetailsSection) oldDetailsSection.remove()
                
                // Rebuild expandable section for new image if it has text_to_image data
                if (imageViewerImages[idx].text_to_image) {
                    const expandToggle = document.createElement('div')
                    expandToggle.style.cssText = `display: flex; align-items: center; justify-content: center; margin-top: 12px; cursor: pointer; user-select: none; padding: 8px; min-width: 40px; min-height: 30px; border-radius: 8px; border: 2px solid ${colorScheme.textSecondary};`
                    
                    const triangle = document.createElement('span')
                    triangle.innerHTML = '▼'
                    triangle.style.cssText = `font-size: 14px; color: ${colorScheme.textSecondary}; transition: transform 0.3s; pointer-events: none;`
                    expandToggle.appendChild(triangle)
                    
                    const detailsSection = document.createElement('div')
                    detailsSection.className = 'metadata-details'
                    detailsSection.style.cssText = `display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid ${colorScheme.border}; text-align: left; max-height: 300px; overflow-y: auto;`
                    
                    // Build details content
                    let detailsHTML = ''
                    const t2i = imageViewerImages[idx].text_to_image
                    
                    if (t2i.prompt) {
                        detailsHTML += `<div style="margin-bottom: 12px;"><strong style="color: ${colorScheme.accent};">Prompt:</strong><div style="color: ${colorScheme.textPrimary}; font-size: 11px; line-height: 1.5; margin-top: 4px; word-wrap: break-word;">${t2i.prompt}</div></div>`
                    }
                    
                    if (t2i.negative_prompt) {
                        detailsHTML += `<div style="margin-bottom: 12px;"><strong style="color: ${colorScheme.accent};">Negative Prompt:</strong><div style="color: ${colorScheme.textSecondary}; font-size: 11px; line-height: 1.5; margin-top: 4px; word-wrap: break-word;">${t2i.negative_prompt}</div></div>`
                    }
                    
                    // Technical details in a grid
                    detailsHTML += `<div style="margin-bottom: 8px;"><strong style="color: ${colorScheme.accent};">Generation Settings:</strong></div>`
                    detailsHTML += `<div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 11px;">`
                    
                    if (t2i.width && t2i.height) {
                        detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Size:</span><span style="color: ${colorScheme.textPrimary};">${t2i.width} × ${t2i.height}</span>`
                    }
                    if (t2i.sampling_steps) {
                        detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Steps:</span><span style="color: ${colorScheme.textPrimary};">${t2i.sampling_steps}</span>`
                    }
                    if (t2i.sampling_method) {
                        detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Sampler:</span><span style="color: ${colorScheme.textPrimary};">${t2i.sampling_method}</span>`
                    }
                    if (t2i.cfg_scale) {
                        detailsHTML += `<span style="color: ${colorScheme.textSecondary};">CFG Scale:</span><span style="color: ${colorScheme.textPrimary};">${t2i.cfg_scale}</span>`
                    }
                    if (t2i.seed !== undefined) {
                        detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Seed:</span><span style="color: ${colorScheme.textPrimary};">${t2i.seed}</span>`
                    }
                    if (t2i.batch_size) {
                        detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Batch Size:</span><span style="color: ${colorScheme.textPrimary};">${t2i.batch_size}</span>`
                    }
                    
                    detailsHTML += `</div>`
                    
                    detailsSection.innerHTML = detailsHTML
                    
                    // Toggle functionality
                    let isExpanded = false
                    expandToggle.addEventListener('click', function(e) {
                        e.stopPropagation()
                        isExpanded = !isExpanded
                        if (isExpanded) {
                            detailsSection.style.display = 'block'
                            triangle.style.transform = 'rotate(180deg)'
                        } else {
                            detailsSection.style.display = 'none'
                            triangle.style.transform = 'rotate(0deg)'
                        }
                    })
                    
                    metadata.appendChild(expandToggle)
                    metadata.appendChild(detailsSection)
                }
                
                // Fade in
                img.style.opacity = '1'
                metadata.style.opacity = '1'
                
                // Update arrow visibility
                leftArrow.style.opacity = idx === 0 ? '0.3' : '1'
                rightArrow.style.opacity = idx === imageViewerImages.length - 1 ? '0.3' : '1'
            }, 150)
        }

        // Throttle navigation to prevent key repeat from skipping
        let navLocked = false
        const navigate = (delta) => {
            if (navLocked) return
            const next = currentImageViewerIndex + delta
            if (next < 0 || next >= imageViewerImages.length) return
            navLocked = true
            showImageAtIndex(next)
            setTimeout(() => { navLocked = false }, 180)
        }

        // Create close button (circle with X)
        const closeBtn = document.createElement('button')
        closeBtn.innerHTML = '✕'
        closeBtn.style.cssText = `position: fixed; top: 20px; right: 20px; width: 48px; height: 48px; border-radius: 50%; background: ${colorScheme.cardBackground}; border: 2px solid ${colorScheme.border}; color: ${colorScheme.textPrimary}; font-size: 24px; cursor: pointer; z-index: 1000002; display: flex; align-items: center; justify-content: center; transition: all 0.2s; font-weight: bold;`
        closeBtn.addEventListener('click', closeImageViewer)
        closeBtn.addEventListener('mouseenter', function() {
            this.style.backgroundColor = colorScheme.hoverBackground
            this.style.color = colorScheme.hoverText
            this.style.transform = 'scale(1.1)'
        })
        closeBtn.addEventListener('mouseleave', function() {
            this.style.backgroundColor = colorScheme.cardBackground
            this.style.color = colorScheme.textPrimary
            this.style.transform = 'scale(1)'
        })

        // Create metadata toggle container
        const metadataToggleContainer = document.createElement('div')
        metadataToggleContainer.style.cssText = `position: fixed; bottom: 20px; left: 20px; display: flex; align-items: center; gap: 12px; z-index: 1000002;`
        
        // Create toggle switch
        const toggleSwitch = document.createElement('div')
        toggleSwitch.style.cssText = `width: 48px; height: 26px; background: ${colorScheme.cardBackground}; border: 2px solid ${colorScheme.border}; border-radius: 13px; position: relative; cursor: pointer; transition: all 0.3s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);`
        
        const toggleSlider = document.createElement('div')
        toggleSlider.style.cssText = `width: 20px; height: 20px; background: ${colorScheme.textSecondary}; border-radius: 50%; position: absolute; top: 1px; left: 2px; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.4);`
        
        toggleSwitch.appendChild(toggleSlider)
        
        // Create label
        const toggleLabel = document.createElement('span')
        toggleLabel.textContent = 'Metadata'
        toggleLabel.style.cssText = `color: ${colorScheme.textSecondary}; font-size: 14px; font-weight: 500; cursor: pointer; user-select: none;`
        
        // Track toggle state - load from localStorage or default to false
        let isMetadataVisible = localStorage.getItem('hollyMetadataVisible') === 'true'
        
        // Toggle function
        const toggleMetadata = () => {
            const metadata = imageViewerModal.querySelector('.image-metadata')
            if (metadata) {
                isMetadataVisible = !isMetadataVisible
                // Save preference to localStorage
                localStorage.setItem('hollyMetadataVisible', isMetadataVisible)
                
                if (isMetadataVisible) {
                    metadata.style.display = 'block'
                    metadata.style.opacity = '1'
                    toggleSwitch.style.background = colorScheme.gradient
                    toggleSlider.style.left = '24px'
                    toggleSlider.style.background = '#ffffff'
                    toggleLabel.style.color = colorScheme.textSecondary
                } else {
                    metadata.style.display = 'none'
                    toggleSwitch.style.background = colorScheme.cardBackground
                    toggleSlider.style.left = '2px'
                    toggleSlider.style.background = colorScheme.textSecondary
                    toggleLabel.style.color = colorScheme.textPrimary
                }
            }
        }
        
        // Add click listeners
        toggleSwitch.addEventListener('click', toggleMetadata)
        toggleLabel.addEventListener('click', toggleMetadata)
        
        // Initialize based on saved preference
        if (isMetadataVisible) {
            toggleSwitch.style.background = colorScheme.gradient
            toggleSlider.style.left = '24px'
            toggleSlider.style.background = '#ffffff'
            toggleLabel.style.color = colorScheme.textSecondary
        } else {
            toggleSwitch.style.background = colorScheme.cardBackground
            toggleSlider.style.left = '2px'
            toggleSlider.style.background = colorScheme.textSecondary
            toggleLabel.style.color = colorScheme.textPrimary
        }
        
        metadataToggleContainer.appendChild(toggleSwitch)
        metadataToggleContainer.appendChild(toggleLabel)

        // Create download button
        const downloadBtn = document.createElement('button')
        downloadBtn.innerText = 'Download'
        downloadBtn.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: ${colorScheme.gradient}; color: black; padding: clamp(8px, 2vw, 10px) clamp(12px, 3vw, 16px); border-radius: 8px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s; font-size: clamp(12px, 3vw, 14px); min-width: 80px; z-index: 1000002;`
        downloadBtn.addEventListener('click', function() {
            const currentImage = imageViewerImages[currentImageViewerIndex]
            const filename = currentImage.message.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_' + new Date(currentImage.timestamp).toISOString().split('T')[0] + '.jpg'
            
            // Check if this is a CORS-protected image (character photos or background photos)
            const isCorsProtected = currentImage.source && (
                currentImage.source.includes('character.photos.background') ||
                currentImage.source.includes('character.photos.foreground') ||
                currentImage.url.includes('characterphotos')
            )
            
            if (isCorsProtected) {
                // For CORS-protected images, open in new tab for manual download
                console.log('Opening CORS-protected image in new tab:', filename)
                window.open(currentImage.url, '_blank')
            } else {
                // For regular images, use fetch method
                fetch(currentImage.url)
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
                        return response.blob()
                    })
                    .then(blob => {
                        const blobUrl = URL.createObjectURL(blob)
                        const link = document.createElement('a')
                        link.href = blobUrl
                        link.download = filename
                        link.style.display = 'none'
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
                    })
                    .catch(error => {
                        console.error('Download failed:', error)
                        // Fallback: open in new tab if fetch fails
                        console.log('Falling back to opening in new tab')
                        window.open(currentImage.url, '_blank')
                    })
            }
        })
        downloadBtn.addEventListener('mouseenter', function() {
            this.style.background = isYodayo ? '#151820' : '#1A1C1E'
            this.style.color = colorScheme.hoverText
        })
        downloadBtn.addEventListener('mouseleave', function() {
            this.style.background = colorScheme.gradient
            this.style.color = 'black'
        })

        // Create navigation arrows
        const leftArrow = document.createElement('button')
        leftArrow.innerHTML = '←'
        leftArrow.className = 'image-viewer-arrow-left'
        leftArrow.style.cssText = `position: fixed; top: 50%; left: 20px; transform: translateY(-50%); width: 56px; height: 56px; border-radius: 50%; background: ${colorScheme.cardBackground}; border: 2px solid ${colorScheme.border}; color: ${colorScheme.textPrimary}; font-size: 28px; cursor: pointer; z-index: 1000002; display: flex; align-items: center; justify-content: center; transition: all 0.2s; opacity: ${index === 0 ? '0.3' : '1'};`
        leftArrow.addEventListener('click', function(e) {
            e.stopPropagation()
            navigate(-1)
        })
        leftArrow.addEventListener('mouseenter', function() {
            this.style.backgroundColor = colorScheme.hoverBackground
            this.style.color = colorScheme.hoverText
            this.style.transform = 'translateY(-50%) scale(1.1)'
        })
        leftArrow.addEventListener('mouseleave', function() {
            this.style.backgroundColor = colorScheme.cardBackground
            this.style.color = colorScheme.textPrimary
            this.style.transform = 'translateY(-50%) scale(1)'
        })

        const rightArrow = document.createElement('button')
        rightArrow.innerHTML = '→'
        rightArrow.className = 'image-viewer-arrow-right'
        rightArrow.style.cssText = `position: fixed; top: 50%; right: 20px; transform: translateY(-50%); width: 56px; height: 56px; border-radius: 50%; background: ${colorScheme.cardBackground}; border: 2px solid ${colorScheme.border}; color: ${colorScheme.textPrimary}; font-size: 28px; cursor: pointer; z-index: 1000002; display: flex; align-items: center; justify-content: center; transition: all 0.2s; opacity: ${index === imageViewerImages.length - 1 ? '0.3' : '1'};`
        rightArrow.addEventListener('click', function(e) {
            e.stopPropagation()
            navigate(1)
        })
        rightArrow.addEventListener('mouseenter', function() {
            this.style.backgroundColor = colorScheme.hoverBackground
            this.style.color = colorScheme.hoverText
            this.style.transform = 'translateY(-50%) scale(1.1)'
        })
        rightArrow.addEventListener('mouseleave', function() {
            this.style.backgroundColor = colorScheme.cardBackground
            this.style.color = colorScheme.textPrimary
            this.style.transform = 'translateY(-50%) scale(1)'
        })

        // Create image
        const img = document.createElement('img')
        img.src = imageData.url
        img.style.cssText = 'max-width: 95vw; max-height: 95vh; object-fit: contain; border-radius: 8px; transition: opacity 0.15s;'
        
        // Add metadata below image
        const metadata = document.createElement('div')
        metadata.className = 'image-metadata'
        // Check localStorage for user's metadata visibility preference
        const savedMetadataVisible = localStorage.getItem('hollyMetadataVisible') === 'true'
        const initialDisplay = savedMetadataVisible ? 'block' : 'none'
        metadata.style.cssText = `position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; padding: 12px 20px; border-radius: 8px; border: 1px solid ${colorScheme.border}; font-size: 14px; max-width: 80vw; text-align: center; transition: opacity 0.15s; display: ${initialDisplay};`
        
        const message = document.createElement('div')
        message.className = 'metadata-message'
        message.style.cssText = `margin-bottom: 8px; font-weight: 500; color: ${colorScheme.textPrimary};`
        message.textContent = imageData.message
        
        const timestamp = document.createElement('div')
        timestamp.className = 'metadata-timestamp'
        timestamp.style.cssText = `font-size: 12px; color: ${colorScheme.textSecondary};`
        timestamp.textContent = new Date(imageData.timestamp).toLocaleString()
        
        const model = document.createElement('div')
        model.className = 'metadata-model'
        model.style.cssText = `font-size: 12px; color: ${colorScheme.accent}; margin-top: 4px;`
        model.textContent = imageData.model || 'Unknown Model'
        
        metadata.appendChild(message)
        metadata.appendChild(timestamp)
        metadata.appendChild(model)
        
        // Add expandable details section if we have text_to_image data
        if (imageData.text_to_image) {
            const expandToggle = document.createElement('div')
            expandToggle.style.cssText = `display: flex; align-items: center; justify-content: center; margin-top: 12px; cursor: pointer; user-select: none; padding: 8px; min-width: 40px; min-height: 30px; border-radius: 8px; border: 2px solid ${colorScheme.textSecondary};`
            
            const triangle = document.createElement('span')
            triangle.innerHTML = '▼'
            triangle.style.cssText = `font-size: 14px; color: ${colorScheme.textSecondary}; transition: transform 0.3s; pointer-events: none;`
            expandToggle.appendChild(triangle)
            
            const detailsSection = document.createElement('div')
            detailsSection.className = 'metadata-details'
            detailsSection.style.cssText = `display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid ${colorScheme.border}; text-align: left; max-height: 300px; overflow-y: auto;`
            
            // Build details content
            let detailsHTML = ''
            const t2i = imageData.text_to_image
            
            if (t2i.prompt) {
                detailsHTML += `<div style="margin-bottom: 12px;"><strong style="color: ${colorScheme.accent};">Prompt:</strong><div style="color: ${colorScheme.textPrimary}; font-size: 11px; line-height: 1.5; margin-top: 4px; word-wrap: break-word;">${t2i.prompt}</div></div>`
            }
            
            if (t2i.negative_prompt) {
                detailsHTML += `<div style="margin-bottom: 12px;"><strong style="color: ${colorScheme.accent};">Negative Prompt:</strong><div style="color: ${colorScheme.textSecondary}; font-size: 11px; line-height: 1.5; margin-top: 4px; word-wrap: break-word;">${t2i.negative_prompt}</div></div>`
            }
            
            // Technical details in a grid
            detailsHTML += `<div style="margin-bottom: 8px;"><strong style="color: ${colorScheme.accent};">Generation Settings:</strong></div>`
            detailsHTML += `<div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 11px;">`
            
            if (t2i.width && t2i.height) {
                detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Size:</span><span style="color: ${colorScheme.textPrimary};">${t2i.width} × ${t2i.height}</span>`
            }
            if (t2i.sampling_steps) {
                detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Steps:</span><span style="color: ${colorScheme.textPrimary};">${t2i.sampling_steps}</span>`
            }
            if (t2i.sampling_method) {
                detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Sampler:</span><span style="color: ${colorScheme.textPrimary};">${t2i.sampling_method}</span>`
            }
            if (t2i.cfg_scale) {
                detailsHTML += `<span style="color: ${colorScheme.textSecondary};">CFG Scale:</span><span style="color: ${colorScheme.textPrimary};">${t2i.cfg_scale}</span>`
            }
            if (t2i.seed !== undefined) {
                detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Seed:</span><span style="color: ${colorScheme.textPrimary};">${t2i.seed}</span>`
            }
            if (t2i.batch_size) {
                detailsHTML += `<span style="color: ${colorScheme.textSecondary};">Batch Size:</span><span style="color: ${colorScheme.textPrimary};">${t2i.batch_size}</span>`
            }
            
            detailsHTML += `</div>`
            
            detailsSection.innerHTML = detailsHTML
            
            // Toggle functionality
            let isExpanded = false
            expandToggle.addEventListener('click', function(e) {
                e.stopPropagation()
                isExpanded = !isExpanded
                if (isExpanded) {
                    detailsSection.style.display = 'block'
                    triangle.style.transform = 'rotate(180deg)'
                } else {
                    detailsSection.style.display = 'none'
                    triangle.style.transform = 'rotate(0deg)'
                }
            })
            
            metadata.appendChild(expandToggle)
            metadata.appendChild(detailsSection)
        }

        // Add keyboard listeners
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                // Always close viewer if it's open, and stop propagation so popup handler doesn't fire
                if (imageViewerModal && imageViewerModal.parentNode) {
                    e.preventDefault()
                    e.stopPropagation()
                    closeImageViewer()
                    document.removeEventListener('keydown', keyHandler, true)
                    window.hollyImageViewerKeyHandler = null
                }
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                navigate(-1)
            } else if (e.key === 'ArrowRight') {
                e.preventDefault()
                navigate(1)
            }
        }
        // Use capture phase so this handler fires before the popup's handler
        document.addEventListener('keydown', keyHandler, true)
        window.hollyImageViewerKeyHandler = keyHandler

        contentContainer.appendChild(img)
        contentContainer.appendChild(metadata)
        document.body.appendChild(closeBtn)
        document.body.appendChild(metadataToggleContainer)
        document.body.appendChild(downloadBtn)
        document.body.appendChild(leftArrow)
        document.body.appendChild(rightArrow)

        // Trigger animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.75)'
                backdrop.style.backdropFilter = 'blur(8px)'
                backdrop.style.webkitBackdropFilter = 'blur(8px)'
                imageViewerModal.style.opacity = '1'
                imageViewerModal.style.transform = 'translate(-50%, -50%) scale(1)'
            })
        })
    }

    function closeImageViewer() {
        // Remove keydown handler to prevent event stacking
        if (window.hollyImageViewerKeyHandler) {
            document.removeEventListener('keydown', window.hollyImageViewerKeyHandler, true)
            window.hollyImageViewerKeyHandler = null
        }

        if (imageViewerModal) {
            imageViewerModal.style.opacity = '0'
            imageViewerModal.style.transform = 'translate(-50%, -50%) scale(0.9)'
            
            // Remove backdrop
            const backdrop = document.querySelector('div[style*="z-index: 1000000"]')
            if (backdrop) {
                backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0)'
                backdrop.style.backdropFilter = 'blur(0px)'
                backdrop.style.webkitBackdropFilter = 'blur(0px)'
            }
            
            // Remove all buttons and controls
            const controls = document.querySelectorAll('[style*="z-index: 1000002"]')
            controls.forEach(ctrl => ctrl.style.opacity = '0')
            
            setTimeout(() => {
                if (imageViewerModal && imageViewerModal.parentNode) {
                    imageViewerModal.parentNode.removeChild(imageViewerModal)
                    imageViewerModal = null
                }
                if (backdrop && backdrop.parentNode) {
                    backdrop.parentNode.removeChild(backdrop)
                }
                controls.forEach(ctrl => {
                    if (ctrl.parentNode) ctrl.parentNode.removeChild(ctrl)
                })
            }, 300)
        }
    }

    function filterImages(images, filterValue) {
        const grid = document.querySelector('#images-grid')
        const countSpan = document.querySelector('#image-count')

        if (!grid || !countSpan) return

        // Apply filter
        filteredImages = images
        if (filterValue !== 'all') {
            filteredImages = images.filter(img => img.message && img.message.includes(filterValue))
        }

        // Reset to first page when filtering
        currentPage = 1
        totalImages = filteredImages.length

        // Update count
        countSpan.textContent = totalImages

        // Update pagination controls
        updatePaginationControls()

        // Display current page
        displayCurrentPage()
    }

    function displayCurrentPage() {
        const grid = document.querySelector('#images-grid')
        if (!grid) return

        const startIndex = (currentPage - 1) * pageSize
        const endIndex = Math.min(startIndex + pageSize, filteredImages.length)
        const pageImages = filteredImages.slice(startIndex, endIndex)

        // Rebuild grid content for current page
        let gridContent = ''
        for (let i = 0; i < pageImages.length; i++) {
            const img = pageImages[i]
            const isCharacterPhoto = img.source && (img.source.includes('character.photos.background') || img.source.includes('character.photos.foreground'))
            const checkboxHtml = isCharacterPhoto ? '' : `<input type="checkbox" class="image-checkbox" data-url="${img.url}" data-filename="${img.message.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}_${new Date(img.timestamp).toISOString().split('T')[0]}.jpg" style="position: absolute; top: 8px; right: 8px; width: 16px; height: 16px; cursor: pointer; z-index: 10;">`
            
            // Create a unique data attribute to identify this image
            const imageIndex = startIndex + i
            
            gridContent += `
                <div style="background: ${colorScheme.cardBackground}; border-radius: 8px; padding: clamp(8px, 2vw, 12px); border: 1px solid ${colorScheme.border}; transition: transform 0.2s, box-shadow 0.2s; max-height: 300px; width: clamp(150px, calc(50% - 8px), 220px); flex-shrink: 0; position: relative;" onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 4px 12px ${colorScheme.glowColor}'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'">
                    ${checkboxHtml}
                    <img src="${img.url}" class="grid-image" data-image-index="${imageIndex}" style="width: 100%; height: clamp(120px, 25vw, 200px); object-fit: cover; border-radius: 6px; margin-bottom: clamp(4px, 1vw, 8px); cursor: pointer; border: 1px solid ${colorScheme.border};" onerror="this.style.display='none'; this.nextElementSibling.style.display='block'">
                    <div style="display: none; background: ${colorScheme.border}; color: ${colorScheme.textSecondary}; text-align: center; padding: 20px; border-radius: 6px; margin-bottom: 8px;">Image failed to load</div>
                    <div style="color: ${colorScheme.textSecondary}; font-size: clamp(9px, 2vw, 11px); margin-bottom: clamp(3px, 0.75vw, 6px);">${new Date(img.timestamp).toLocaleString()}</div>
                    <div style="color: ${colorScheme.textPrimary}; font-size: clamp(10px, 2.5vw, 12px); margin-bottom: clamp(3px, 0.75vw, 6px); line-height: 1.4; max-height: 40px; overflow: hidden; text-overflow: ellipsis;">${img.message}</div>
                    ${img.model ? `<div style="color: ${colorScheme.accent}; font-size: clamp(9px, 2vw, 11px); margin-bottom: clamp(2px, 0.5vw, 4px); font-weight: 500;">${img.model}</div>` : ''}
                </div>
            `
        }

        grid.innerHTML = gridContent
        
        // Add click handlers for images
        const gridImages = grid.querySelectorAll('.grid-image')
        gridImages.forEach(img => {
            img.addEventListener('click', function() {
                const index = parseInt(this.dataset.imageIndex)
                showImageViewer(filteredImages[index], index)
            })
        })
    }

    function updatePaginationControls() {
        const pageInfo = document.querySelector('#page-info')
        const prevBtn = document.querySelector('#prev-page-btn')
        const nextBtn = document.querySelector('#next-page-btn')
        const pageSizeSelect = document.querySelector('#page-size-select')
        const pageJumpSelect = document.querySelector('#page-jump-select')

        if (!pageInfo || !prevBtn || !nextBtn) return

        const totalPages = Math.ceil(totalImages / pageSize)
        const startIndex = (currentPage - 1) * pageSize + 1
        const endIndex = Math.min(currentPage * pageSize, totalImages)

        // Update page info
        pageInfo.textContent = `${startIndex}-${endIndex} of ${totalImages}`

        // Update button states
        prevBtn.disabled = currentPage <= 1
        nextBtn.disabled = currentPage >= totalPages

        // Update page size select value
        if (pageSizeSelect) {
            pageSizeSelect.value = pageSize
        }

        // Update page jump dropdown
        if (pageJumpSelect) {
            // Clear existing options
            pageJumpSelect.innerHTML = ''
            
            // Add options for each page
            for (let i = 1; i <= totalPages; i++) {
                const option = document.createElement('option')
                option.value = i
                option.textContent = `Page ${i}`
                if (i === currentPage) {
                    option.selected = true
                }
                pageJumpSelect.appendChild(option)
            }
        }
    }

    function showChatImages(messages, chatIndex, chatData = null) {
        closeImagePopup()

        // Reset button state
        const photoButtons = document.querySelectorAll('button')
        for (let i = 0; i < photoButtons.length; i++) {
            if (photoButtons[i].innerText.includes('Loading')) {
                photoButtons[i].busy = false
                photoButtons[i].innerText = 'Images'
                photoButtons[i].style.background = '#374151'
                break
            }
        }

        // Create backdrop overlay
        const backdrop = document.createElement('div')
        backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0); z-index: 999998; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); transition: background-color 0.25s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease;'
        backdrop.onclick = closeImagePopup
        document.body.appendChild(backdrop)

        // Add ESC key listener
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                // Don't close popup if image viewer is open - let viewer handle ESC
                if (imageViewerModal && imageViewerModal.parentNode) {
                    return
                }
                closeImagePopup()
                document.removeEventListener('keydown', escHandler)
            }
        }
        document.addEventListener('keydown', escHandler)

        // Debug: Log the first message structure to see what fields are available
        console.log('First message structure:', messages[0])
        console.log('All message keys:', messages.map(m => Object.keys(m)))

        // Extract images from messages - get full-size images from both output_image_url and output_images
        const chatImages = []

        // First, get character photos from the chat data (like the original script)
        // Use the chat data passed from the chat list, which contains the character photos
        if (chatData && chatData.chars) {
            console.log('Chat data with characters:', chatData)

            for (let charIndex = 0; charIndex < chatData.chars.length; charIndex++) {
                const char = chatData.chars[charIndex]
                console.log(`Character ${charIndex}:`, char)

                // Add character foreground photos (no checkboxes, like background photos)
                if (char.photos && char.photos.foreground && Array.isArray(char.photos.foreground)) {
                    console.log(`Found character foreground photos:`, char.photos.foreground)
                    for (let j = 0; j < char.photos.foreground.length; j++) {
                        const photoUrl = char.photos.foreground[j]
                        if (photoUrl && photoUrl.startsWith('http')) {
                            console.log(`Found character photo ${j + 1}:`, photoUrl)
                            chatImages.push({
                                url: photoUrl,
                                message: `Character Photo ${j + 1}`,
                                timestamp: messages[0] ? messages[0].created_at : new Date().toISOString(),
                                source: 'character.photos.foreground',
                                model: 'Character Photo'
                            })
                        }
                    }
                } else {
                    console.log(`No character foreground photos found for character ${charIndex}`)
                }

                // Add character background photos
                if (char.photos && char.photos.background && Array.isArray(char.photos.background)) {
                    console.log(`Found character background photos:`, char.photos.background)
                    for (let j = 0; j < char.photos.background.length; j++) {
                        const photoUrl = char.photos.background[j]
                        if (photoUrl && photoUrl.startsWith('http')) {
                            console.log(`Found character background ${j + 1}:`, photoUrl)
                            chatImages.push({
                                url: photoUrl,
                                message: `Background Photo ${j + 1}`,
                                timestamp: messages[0] ? messages[0].created_at : new Date().toISOString(),
                                source: 'character.photos.background',
                                model: 'Background Photo'
                            })
                        }
                    }
                }
            }
        }

        // Then get generated images from text_to_image messages
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]

            if (msg.text_to_image) {
                // Debug: Log all available fields in text_to_image
                console.log('=== MESSAGE WITH IMAGES ===')
                console.log('Message UUID:', msg.uuid)
                console.log('Message text:', msg.message)
                console.log('text_to_image fields:', Object.keys(msg.text_to_image))
                console.log('text_to_image full object:', JSON.stringify(msg.text_to_image, null, 2))

                // Get the main output_image_url (usually the first/primary image)
                if (msg.text_to_image.output_image_url) {
                    console.log('Found full-size image (primary):', msg.text_to_image.output_image_url)
                    chatImages.push({
                        url: msg.text_to_image.output_image_url,
                        message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                        timestamp: msg.created_at,
                        source: 'text_to_image.output_image_url',
                        model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                        text_to_image: msg.text_to_image // Store full metadata
                    })
                }

                // Check ALL fields in text_to_image for potential image URLs
                console.log('=== CHECKING ALL FIELDS FOR IMAGE URLS ===')
                for (const [key, value] of Object.entries(msg.text_to_image)) {
                    // Skip the primary output_image_url field since we already added it
                    if (key === 'output_image_url') {
                        continue
                    }
                    
                    if (typeof value === 'string' && value.startsWith('http') && value.includes('.jpg')) {
                        console.log(`Found potential image URL in field '${key}':`, value)
                        // Check if this is different from the primary image and not a thumbnail
                        const isThumbnail = value.includes('-resized') ||
                                           value.includes('width%3D256') ||
                                           value.includes('width=256') ||
                                           value.includes('width%3D512') ||
                                           value.includes('width=512') ||
                                           value.includes('thumbnail') ||
                                           value.includes('thumb') ||
                                           value.includes('small') ||
                                           value.includes('preview')

                        // Also check if this URL matches the primary output_image_url
                        const urlNormalized = value.split('?')[0]
                        const primaryUrlNormalized = msg.text_to_image.output_image_url ? msg.text_to_image.output_image_url.split('?')[0] : ''
                        
                        if (urlNormalized !== primaryUrlNormalized && !isThumbnail) {
                            console.log(`This is a different full-size image from the primary!`)
                            chatImages.push({
                                url: value,
                                message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                                timestamp: msg.created_at,
                                source: `text_to_image.${key}`,
                                model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                                text_to_image: msg.text_to_image // Store full metadata for batch images
                            })
                        } else if (isThumbnail) {
                            console.log(`Skipping thumbnail image in field '${key}':`, value)
                        }
                    } else if (Array.isArray(value)) {
                        console.log(`Field '${key}' is an array with ${value.length} items`)
                        for (let j = 0; j < value.length; j++) {
                            const item = value[j]
                            if (typeof item === 'string' && item.startsWith('http') && item.includes('.jpg')) {
                                console.log(`Found potential image URL in array '${key}[${j}]:`, item)
                                // Check if this is different from the primary image and not a thumbnail
                                const isThumbnail = item.includes('-resized') ||
                                                   item.includes('width%3D256') ||
                                                   item.includes('width=256') ||
                                                   item.includes('width%3D512') ||
                                                   item.includes('width=512') ||
                                                   item.includes('thumbnail') ||
                                                   item.includes('thumb') ||
                                                   item.includes('small') ||
                                                   item.includes('preview')

                                if (item !== msg.text_to_image.output_image_url && !isThumbnail) {
                                    console.log(`This is a different full-size image from the primary!`)
                                    chatImages.push({
                                        url: item,
                                        message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                                        timestamp: msg.created_at,
                                        source: `text_to_image.${key}[${j}]`,
                                        model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                                        text_to_image: msg.text_to_image // Store full metadata for batch images
                                    })
                                } else if (isThumbnail) {
                                    console.log(`Skipping thumbnail image in array '${key}[${j}]:`, item)
                                }
                            } else if (item && typeof item === 'object') {
                                console.log(`Array item '${key}[${j}]' is an object with keys:`, Object.keys(item))
                                for (const [subKey, subValue] of Object.entries(item)) {
                                    if (typeof subValue === 'string' && subValue.startsWith('http') && subValue.includes('.jpg')) {
                                        console.log(`Found potential image URL in '${key}[${j}].${subKey}':`, subValue)
                                        // Check if this is different from the primary image and not a thumbnail
                                        const isThumbnail = subValue.includes('-resized') ||
                                                           subValue.includes('width%3D256') ||
                                                           subValue.includes('width=256') ||
                                                           subValue.includes('width%3D512') ||
                                                           subValue.includes('width=512') ||
                                                           subValue.includes('thumbnail') ||
                                                           subValue.includes('thumb') ||
                                                           subValue.includes('small') ||
                                                           subValue.includes('preview')

                                        if (subValue !== msg.text_to_image.output_image_url && !isThumbnail) {
                                            console.log(`This is a different full-size image from the primary!`)
                                            chatImages.push({
                                                url: subValue,
                                                message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                                                timestamp: msg.created_at,
                                                source: `text_to_image.${key}[${j}].${subKey}`,
                                                model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                                                text_to_image: msg.text_to_image // Store full metadata for batch images
                                            })
                                        } else if (isThumbnail) {
                                            console.log(`Skipping thumbnail image in '${key}[${j}].${subKey}':`, subValue)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Check for other possible image fields
                const possibleImageFields = ['output_images', 'images', 'generated_images', 'result_images', 'full_images']
                for (const fieldName of possibleImageFields) {
                    if (msg.text_to_image[fieldName] && Array.isArray(msg.text_to_image[fieldName])) {
                        console.log(`Found ${fieldName} array with`, msg.text_to_image[fieldName].length, 'images')
                        console.log(`Full ${fieldName} array:`, msg.text_to_image[fieldName])

                        for (let j = 0; j < msg.text_to_image[fieldName].length; j++) {
                            const img = msg.text_to_image[fieldName][j]
                            console.log(`${fieldName}[${j}]:`, img)
                            let imageUrl = null

                            if (typeof img === 'string' && img.startsWith('http')) {
                                imageUrl = img
                                console.log(`Found string URL in ${fieldName}[${j}]:`, imageUrl)
                            } else if (img && typeof img === 'object') {
                                console.log(`${fieldName}[${j}] object keys:`, Object.keys(img))
                                // Try different possible URL fields in the image object
                                imageUrl = img.url || img.src || img.image_url || img.link || img.href || img.full_url || img.original_url || img.image || img.thumbnail_url || img.full_image_url
                                if (imageUrl) {
                                    console.log(`Found object URL in ${fieldName}[${j}]:`, imageUrl)
                                }
                            }

                            if (imageUrl && imageUrl.startsWith('http')) {
                                // Check if this is a full-size image (not resized/thumbnail)
                                const isThumbnail = imageUrl.includes('-resized') ||
                                                   imageUrl.includes('width%3D256') ||
                                                   imageUrl.includes('width=256') ||
                                                   imageUrl.includes('width%3D512') ||
                                                   imageUrl.includes('width=512') ||
                                                   imageUrl.includes('thumbnail') ||
                                                   imageUrl.includes('thumb') ||
                                                   imageUrl.includes('small') ||
                                                   imageUrl.includes('preview')

                                if (!isThumbnail) {
                                    console.log(`Found additional full-size image in ${fieldName}:`, imageUrl)
                                    chatImages.push({
                                        url: imageUrl,
                                        message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                                        timestamp: msg.created_at,
                                        source: `text_to_image.${fieldName}`,
                                        model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                                        text_to_image: msg.text_to_image // Store full metadata for batch images
                                    })
                                } else {
                                    console.log(`Skipping thumbnail image in ${fieldName}:`, imageUrl)
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log('Found images:', chatImages)

        // Deduplicate images by URL (comparing normalized URLs to catch query parameter differences)
        const uniqueImages = []
        const seenUrls = new Set()

        console.log('Before deduplication - all images:', chatImages.map(img => ({ url: img.url, source: img.source, model: img.model })))

        // Function to normalize URLs (remove query params for comparison)
        const normalizeUrl = (url) => {
            try {
                const urlObj = new URL(url)
                // Return URL without query params
                return urlObj.origin + urlObj.pathname
            } catch {
                // If URL parsing fails, return as-is
                return url.split('?')[0]
            }
        }

        for (const img of chatImages) {
            const normalizedUrl = normalizeUrl(img.url)
            if (!seenUrls.has(normalizedUrl)) {
                seenUrls.add(normalizedUrl)
                uniqueImages.push(img)
                console.log('Added unique image:', { url: img.url, normalizedUrl, source: img.source, model: img.model })
            } else {
                console.log('Skipped duplicate image:', { url: img.url, normalizedUrl, source: img.source, model: img.model })
            }
        }

        console.log('Unique images after deduplication:', uniqueImages.length)

        // Initialize pagination
        filteredImages = uniqueImages
        totalImages = uniqueImages.length
        currentPage = 1

        imagePopup = document.createElement('div')
        imagePopup.className = 'image-popup'
        imagePopup.style.cssText = `background-color: ${colorScheme.background}; border: 1px solid ${colorScheme.border}; border-radius: 12px; padding: 0; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); z-index: 999999; box-shadow: 0 8px 32px rgba(0,0,0,0.5); width: 90vw; max-width: 985px; height: 90vh; max-height: 860px; display: flex; flex-direction: column; overflow: hidden; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease;`

        if (uniqueImages.length === 0) {
            imagePopup.innerHTML = `
                <div style="color: ${colorScheme.textSecondary}; text-align: center; padding: 20px;">
                    <div>No images found in this chat</div>
                    <div style="font-size: 12px; margin-top: 10px; color: ${colorScheme.textSecondary};">
                        Check browser console for debug info
                    </div>
                </div>
            `
        } else {
            imagePopup.innerHTML = `
                <div style="display: flex; flex-direction: column; padding: clamp(12px, 3vw, 20px); border-bottom: 1px solid ${colorScheme.border}; flex-shrink: 0; gap: clamp(12px, 3vw, 16px);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="color: ${colorScheme.textPrimary}; font-weight: 600; font-size: clamp(16px, 4vw, 24px);">Chat Images (<span id="image-count">${totalImages}</span>)</div>
                        <button id="close-image-modal" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: none; border-radius: 6px; padding: clamp(6px, 1.5vw, 8px) clamp(12px, 3vw, 16px); cursor: pointer; font-size: clamp(12px, 3vw, 14px); white-space: nowrap; flex-shrink: 0;">X</button>
                    </div>
                    <div style="display: flex; align-items: center; gap: clamp(8px, 2vw, 12px); flex-wrap: wrap;">
                        <select id="image-filter" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 6px; padding: clamp(6px, 1.5vw, 8px) clamp(10px, 2.5vw, 14px); font-size: clamp(12px, 3vw, 14px); cursor: pointer; white-space: nowrap;">
                            <option value="all">All Images</option>
                            <option value="/image you">/image you</option>
                            <option value="/image face">/image face</option>
                            <option value="/image last">/image last</option>
                            <option value="/image raw_last">/image raw_last</option>
                            <option value="Character Photo">Character Photos</option>
                            <option value="Background Photo">Backgrounds</option>
                        </select>
                        <button id="select-all-btn" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 6px; padding: clamp(6px, 1.5vw, 8px) clamp(12px, 3vw, 16px); font-size: clamp(12px, 3vw, 14px); cursor: pointer; transition: background-color 0.2s; white-space: nowrap;">Select All</button>
                        <button id="download-selected-btn" style="background: ${colorScheme.gradient}; color: black; border: none; border-radius: 6px; padding: clamp(6px, 1.5vw, 8px) clamp(12px, 3vw, 16px); font-size: clamp(12px, 3vw, 14px); cursor: pointer; transition: all 0.2s; white-space: nowrap;">Download</button>
                    </div>
                </div>
                <div id="images-grid" style="display: flex; gap: clamp(8px, 2vw, 16px); padding: clamp(12px, 3vw, 20px); flex-wrap: wrap; overflow-y: auto; flex: 1; min-height: 0;">
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: clamp(8px, 2vw, 12px) clamp(12px, 3vw, 20px); border-top: 1px solid ${colorScheme.border}; flex-shrink: 0; background: ${colorScheme.cardBackground}; flex-wrap: wrap; gap: clamp(8px, 2vw, 12px);">
                    <div style="display: flex; align-items: center; gap: clamp(6px, 1.5vw, 12px); flex-wrap: wrap;">
                        <span style="color: ${colorScheme.textSecondary}; font-size: clamp(10px, 2.5vw, 12px); white-space: nowrap;">Show:</span>
                        <select id="page-size-select" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 4px; padding: clamp(2px, 0.5vw, 4px) clamp(6px, 1.5vw, 8px); font-size: clamp(10px, 2.5vw, 12px); cursor: pointer;">
                            <option value="8">8</option>
                            <option value="20" selected>20</option>
                            <option value="50">50</option>
                        </select>
                    </div>
                    <div style="display: flex; align-items: center; gap: clamp(6px, 1.5vw, 12px); flex-wrap: wrap;">
                        <button id="prev-page-btn" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 4px; padding: clamp(4px, 1vw, 6px) clamp(8px, 2vw, 12px); font-size: clamp(10px, 2.5vw, 12px); cursor: pointer; transition: background-color 0.2s; white-space: nowrap;"><</button>
                        <span id="page-info" style="color: ${colorScheme.textPrimary}; font-size: clamp(10px, 2.5vw, 12px); white-space: nowrap;">1-20 of ${totalImages}</span>
                        <button id="next-page-btn" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 4px; padding: clamp(4px, 1vw, 6px) clamp(8px, 2vw, 12px); font-size: clamp(10px, 2.5vw, 12px); cursor: pointer; transition: background-color 0.2s; white-space: nowrap;">></button>
                        <span style="color: ${colorScheme.textSecondary}; font-size: clamp(10px, 2.5vw, 12px); white-space: nowrap;">Go to:</span>
                        <select id="page-jump-select" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 4px; padding: clamp(2px, 0.5vw, 4px) clamp(6px, 1.5vw, 8px); font-size: clamp(10px, 2.5vw, 12px); cursor: pointer;">
                        </select>
                    </div>
                </div>
            `

            // Add event listeners
            setTimeout(() => {
                const closeBtn = imagePopup.querySelector('#close-image-modal')
                if (closeBtn) {
                    closeBtn.addEventListener('click', closeImagePopup)
                }

                const filterSelect = imagePopup.querySelector('#image-filter')
                if (filterSelect) {
                    filterSelect.addEventListener('change', function() {
                        filterImages(uniqueImages, this.value)
                    })
                }

                const selectAllBtn = imagePopup.querySelector('#select-all-btn')
                if (selectAllBtn) {
                    selectAllBtn.addEventListener('click', function() {
                        const checkboxes = imagePopup.querySelectorAll('.image-checkbox')
                        const allChecked = Array.from(checkboxes).every(cb => cb.checked)

                        checkboxes.forEach(cb => {
                            cb.checked = !allChecked
                        })

                        this.textContent = allChecked ? 'Select All' : 'Deselect All'
                    })
                }

                // Pagination controls
                const pageSizeSelect = imagePopup.querySelector('#page-size-select')
                if (pageSizeSelect) {
                    pageSizeSelect.addEventListener('change', function() {
                        pageSize = parseInt(this.value)
                        currentPage = 1
                        updatePaginationControls()
                        displayCurrentPage()
                    })
                }

                const prevBtn = imagePopup.querySelector('#prev-page-btn')
                if (prevBtn) {
                    prevBtn.addEventListener('click', function() {
                        if (currentPage > 1) {
                            currentPage--
                            updatePaginationControls()
                            displayCurrentPage()
                        }
                    })
                }

                const nextBtn = imagePopup.querySelector('#next-page-btn')
                if (nextBtn) {
                    nextBtn.addEventListener('click', function() {
                        const totalPages = Math.ceil(totalImages / pageSize)
                        if (currentPage < totalPages) {
                            currentPage++
                            updatePaginationControls()
                            displayCurrentPage()
                        }
                    })
                }

                const pageJumpSelect = imagePopup.querySelector('#page-jump-select')
                if (pageJumpSelect) {
                    pageJumpSelect.addEventListener('change', function() {
                        const selectedPage = parseInt(this.value)
                        if (selectedPage >= 1 && selectedPage <= Math.ceil(totalImages / pageSize)) {
                            currentPage = selectedPage
                            updatePaginationControls()
                            displayCurrentPage()
                        }
                    })
                }

                // Initialize display
                updatePaginationControls()
                displayCurrentPage()

                const downloadSelectedBtn = imagePopup.querySelector('#download-selected-btn')
                if (downloadSelectedBtn) {
                    // Add hover effects
                    downloadSelectedBtn.addEventListener('mouseenter', function() { 
                        this.style.background = colorScheme.hoverBackground
                        this.style.color = colorScheme.hoverText
                    })
                    downloadSelectedBtn.addEventListener('mouseleave', function() { 
                        this.style.background = colorScheme.gradient
                        this.style.color = 'black'
                    })
                    
                    downloadSelectedBtn.addEventListener('click', async function() {
                        // Get all checked images from all pages by collecting URLs from checked checkboxes
                        const checkedBoxes = imagePopup.querySelectorAll('.image-checkbox:checked')
                        const checkedUrls = new Set()
                        
                        // Collect URLs from currently visible checkboxes
                        checkedBoxes.forEach(cb => {
                            checkedUrls.add(cb.dataset.url)
                        })

                        // Find all images that match the checked URLs from the filtered images
                        const imagesToDownload = filteredImages.filter(img => checkedUrls.has(img.url))

                        console.log('Download selected clicked. Found checked boxes:', checkedBoxes.length)
                        console.log('Images to download:', imagesToDownload.length)
                        console.log('Images details:', imagesToDownload.map(img => ({ url: img.url, filename: img.message.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_' + new Date(img.timestamp).toISOString().split('T')[0] + '.jpg' })))

                        if (imagesToDownload.length === 0) {
                            alert('Please select at least one image to download.')
                            return
                        }

                        // Show loading state
                        const originalText = this.textContent
                        this.textContent = 'Downloading...'
                        this.disabled = true

                        try {
                            // Download images in batches of 5 to avoid overwhelming the server
                            const batchSize = 5
                            const batchDelay = 1000 // 1 second delay between batches
                            const results = []
                            let successful = 0
                            let failed = 0

                            // Process images in batches
                            for (let batchStart = 0; batchStart < imagesToDownload.length; batchStart += batchSize) {
                                const batch = imagesToDownload.slice(batchStart, batchStart + batchSize)
                                const batchNumber = Math.floor(batchStart / batchSize) + 1
                                const totalBatches = Math.ceil(imagesToDownload.length / batchSize)

                                console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} images)`)

                                // Update button text to show progress
                                this.textContent = `Downloading batch ${batchNumber}/${totalBatches}...`

                                // Process current batch
                                const batchPromises = batch.map(async (img, index) => {
                                    const url = img.url
                                    const filename = img.message.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_' + new Date(img.timestamp).toISOString().split('T')[0] + '.jpg'
                                    const globalIndex = batchStart + index + 1

                                    console.log(`Starting download ${globalIndex}/${imagesToDownload.length}: ${filename}`)

                                    try {
                                        // Check if this is a CORS-protected URL (character photos)
                                        const isCorsProtected = url.includes('characterphotos.yodayo.com')

                                        if (isCorsProtected) {
                                            // For CORS-protected images, open in new tab for manual download
                                            console.log(`Opening CORS-protected image in new tab: ${filename}`)

                                            // Add a delay to prevent popup blocking
                                            await new Promise(resolve => setTimeout(resolve, index * 200))

                                            const newTab = window.open(url, '_blank')
                                            if (newTab) {
                                                console.log(`Opened ${filename} in new tab for manual download`)
                                                return { success: true, filename, method: 'new_tab', note: 'Please right-click and save the image' }
                                            } else {
                                                console.log(`Failed to open new tab for ${filename}`)
                                                return { success: false, filename, error: 'Popup blocked' }
                                            }
                                        } else {
                                            // For regular images, use fetch method
                                            console.log(`Attempting fetch for: ${filename}`)

                                            const response = await fetch(url)
                                            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

                                            const blob = await response.blob()

                                            // Create blob URL and download
                                            const blobUrl = URL.createObjectURL(blob)
                                            const link = document.createElement('a')
                                            link.href = blobUrl
                                            link.download = filename
                                            link.style.display = 'none'
                                            document.body.appendChild(link)
                                            link.click()
                                            document.body.removeChild(link)

                                            // Clean up blob URL after a delay
                                            setTimeout(() => URL.revokeObjectURL(blobUrl), 2000)

                                            console.log(`Successfully downloaded: ${filename}`)
                                            return { success: true, filename, method: 'fetch_download' }
                                        }
                                    } catch (error) {
                                        console.error(`Failed to download ${filename}:`, error)
                                        return { success: false, filename, error }
                                    }
                                })

                                // Wait for current batch to complete
                                const batchResults = await Promise.all(batchPromises)
                                results.push(...batchResults)

                                // Update counters
                                successful += batchResults.filter(r => r.success).length
                                failed += batchResults.filter(r => !r.success).length

                                console.log(`Batch ${batchNumber} complete: ${successful} successful, ${failed} failed so far`)

                                // Add delay between batches (except for the last batch)
                                if (batchStart + batchSize < imagesToDownload.length) {
                                    console.log(`Waiting ${batchDelay}ms before next batch...`)
                                    await new Promise(resolve => setTimeout(resolve, batchDelay))
                                }
                            }

                            console.log(`Download complete: ${successful} successful, ${failed} failed`)
                        } catch (error) {
                            console.error('Download error:', error)
                            alert('Some images failed to download. Check console for details.')
                        } finally {
                            // Reset button state
                            this.textContent = originalText
                            this.disabled = false
                        }
                    })
                }
            }, 100)
        }

        // Append the popup to the body for proper centering
        document.body.appendChild(imagePopup)
        
        // Trigger animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
                backdrop.style.backdropFilter = 'blur(4px)'
                backdrop.style.webkitBackdropFilter = 'blur(4px)'
                imagePopup.style.opacity = '1'
                imagePopup.style.transform = 'translate(-50%, -50%) scale(1)'
            })
        })
    }

    function retrieveConversationChunk(uuid, offset, collected, btn, chatIndex = null)
        {
        ajax('https://api.' + location.hostname + '/v1/chats/' + uuid + '/messages?limit=' + QUERY_BATCH_SIZE + '&offset=' + offset, false, function (r)
            {
            r = JSON.parse(r)
            if (!r || r.error)
                return

            collected = collected.concat(r.messages)

            if (r.messages.length == QUERY_BATCH_SIZE)
                retrieveConversationChunk(uuid, offset + QUERY_BATCH_SIZE, collected, btn, chatIndex)
            else
                {
                btn.busy = false
                btn.innerText = chatIndex !== null ? 'Images' : 'Download'

                if (collected.length > 0)
                    {
                    // Store images for this chat if we're showing images
                    if (chatIndex !== null) {
                        // Find the chat data for this chatIndex
                        const chatData = window.currentChats ? window.currentChats[chatIndex] : null
                        showChatImages(collected, chatIndex, chatData)
                    } else {
                        exportConversation(collected)
                    }
                    }
                else
                    alert('Nothing to download, this conversation is empty.')
                }
            })
        }

    function sanitizeFileName(s) {
        return (s || 'chat')
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
    }

    function exportConversation(messages) {
        const format = document.getElementById('holly_download_format').value; // 'txt' | 'jsonl-st' | 'jsonl-openai' | 'json'
        let character_name = '';
        let character_uuid = '';
        const out = [];

        // Sort messages by timestamp to ensure chronological order (oldest first)
        const sortedMessages = messages.slice().sort((a, b) => {
            const timeA = new Date(a.created_at).getTime();
            const timeB = new Date(b.created_at).getTime();
            return timeA - timeB;
        });

        for (let i = 0; i < sortedMessages.length; i++) {
            const msg = sortedMessages[i];
            const is_bot = (msg.message_source === 'bot');
            const name = is_bot ? (msg.character?.nickname || 'Character') : 'You';
            const text = msg.message || '';
            const ts = new Date(msg.created_at).getTime();

            if (is_bot) {
                if (!character_name) character_name = name;
                if (!character_uuid) character_uuid = (msg.character?.uuid || '');
            }

            if (format === 'jsonl-st') {
                // Holly's ST flavor (kept for compatibility)
                let variations = null, variation_idx = 0;
                if (msg.message_variations && Array.isArray(msg.message_variations)) {
                    variations = msg.message_variations.map(v => v.message);
                    const idx = msg.message_variations.findIndex(v => v.uuid === msg.uuid);
                    variation_idx = Math.max(0, idx);
                }
                out.push({
                    name,
                    is_user: !is_bot,
                    is_name: is_bot,
                    send_date: ts,
                    mes: text,
                    swipes: variations,
                    swipe_id: variation_idx
                });
            } else if (format === 'jsonl-openai') {
                // Portable, minimal OpenAI-style
                const role = is_bot ? 'assistant' : 'user';
                const rec = {
                    role,
                    content: text,
                    timestamp: ts
                };
                // Optional: include name for multi-assistant training sets
                if (is_bot && name) rec.name = name;

                // Hook for images/attachments if API supplies them (adjust field names)
                if (Array.isArray(msg.attachments) && msg.attachments.length) {
                    rec.images = msg.attachments
                        .filter(a => /https?:\/\//.test(a.url || ''))
                        .map(a => a.url);
                }
                out.push(rec);
            } else if (format === 'json') {
                // Raw-ish JSON passthrough with a small normalization
                out.push({
                    author: name,
                    role: is_bot ? 'assistant' : 'user',
                    timestamp: ts,
                    text,
                    // pass through known useful bits if present:
                    uuid: msg.uuid,
                    character_uuid: msg.character?.uuid || null,
                    variations: msg.message_variations?.map(v => ({ uuid: v.uuid, text: v.message })) || null
                });
            } else { // 'txt'
                out.push(name + '\n\n' + text);
            }
        }

        // Prepend character greeting if available
        const finishAndSave = (greeting) => {
            const now = new Date();
            const baseName = sanitizeFileName(`Chat with ${character_name || 'Character'} ${now.toISOString().slice(0,10)}`);

            if (format === 'jsonl-st') {
                const header = { user_name: 'You', character_name: character_name || 'Character' };
                const lines = [JSON.stringify(header)]
                    .concat(out.map(o => JSON.stringify(o)));
                const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
                download(URL.createObjectURL(blob), `${baseName}.jsonl`);
            } else if (format === 'jsonl-openai') {
                const lines = [];
                if (greeting) {
                    lines.push(JSON.stringify({ role:'assistant', name: character_name || 'Character', content: greeting, timestamp: Date.now() }));
                }
                lines.push(...out.map(o => JSON.stringify(o)));
                const blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' });
                download(URL.createObjectURL(blob), `${baseName}.jsonl`);
            } else if (format === 'json') {
                const payload = {
                    source: location.href,
                    exported_at: new Date().toISOString(),
                    character_name: character_name || null,
                    greeting: greeting || null,
                    messages: out
                };
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                download(URL.createObjectURL(blob), `${baseName}.json`);
            } else { // txt
                const pieces = [];
                if (greeting) pieces.push((character_name || 'Character') + '\n\n' + greeting);
                pieces.push(...out);
                const blob = new Blob([pieces.join('\n\n\n')], { type: 'text/plain' });
                download(URL.createObjectURL(blob), `${baseName}.txt`);
            }
        };

        // Fetch greeting once (as original), then emit
        ajax('https://api.' + location.hostname + '/v1/characters/' + character_uuid, false, function (r) {
            let greeting = null;
            try {
                const j = r ? JSON.parse(r) : null;
                if (j && !j.error) {
                    // maintain compatibility with existing keys
                    greeting = j.char_greeting || j.greeting || null;
                    if (!character_name) character_name = j.char_name || character_name;
                }
            } catch (_) {}
            finishAndSave(greeting);
        });
    }

    function ajax (url, post, callback, csrf, tries=0) {
        try {
            let request = new XMLHttpRequest();
            request.onreadystatechange = function () {
            if (request.readyState !== 4) return;

            const okay = (request.status >= 200 && request.status < 300);
            const notFound = (request.status === 404);

            if (okay || notFound) {
                if (callback) callback(request.responseText, request.getResponseHeader('X-Csrf-Token'), request.status);
                return;
            }

            // Retry on 429/5xx with exponential backoff
            if ((request.status === 429 || (request.status >= 500 && request.status < 600)) && tries < 6) {
                const backoff = Math.min(2000 * Math.pow(2, tries), 15000); // cap at 15s
                console.warn('AJAX retry', request.status, '→ waiting', backoff, 'ms for', url);
                setTimeout(() => ajax(url, post, callback, csrf, tries + 1), backoff);
            } else {
                console.error('AJAX error: HTTP', request.status, 'URL:', url);
                if (callback) callback(null, null, request.status);
            }
            };

            request.withCredentials = true;

            if (post) {
            request.open('POST', url, true);
            if (csrf) request.setRequestHeader('X-Csrf-Token', csrf);
            request.setRequestHeader('Content-Type', 'application/json');
            request.send(JSON.stringify(post));
            } else {
            request.open('GET', url, true);
            request.send();
            }
        } catch (e) {
            console.error('AJAX exception:', e);
            if (tries < 6) {
            const backoff = Math.min(2000 * Math.pow(2, tries), 15000);
            setTimeout(() => ajax(url, post, callback, csrf, tries + 1), backoff);
            }
        }
        }

	function download (path, filename)
        {
        const anchor = document.createElement('a')
        anchor.href = path
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        }

})();
