// ==UserScript==
// @name         Tavern Chat Downloader
// @namespace    Holly
// @author       Holly
// @collaborator Dagyr
// @version      2.2.9
// @description  Preserve your Tavern conversations. Supports both Moescape and Yodayo.
// @match        https://yodayo.com/*
// @match        https://moescape.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=moescape.ai
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/**
 * Tavern Chat Downloader - Main Script
 *
 * FILE STRUCTURE:
 * 1. Configuration & Constants - Global constants and configuration
 * 2. State Management - Global state variables
 * 3. Cache System - Caching for chat data and image counts
 * 4. Chat Manager Module - Chat-related functionality (ChatManager module)
 * 5. Theming & Styling - Color schemes and CSS styles
 * 6. Utility Functions - Reusable utility functions (Utils module)
 * 7. UI Components Module - UI creation functions (UIComponents module)
 * 8. Chat List UI - Modal and UI for displaying chat list
 * 9. Image Manager Module - Image-related functionality (ImageManager module)
 * 10. Conversation Retrieval - Functions to fetch conversation messages
 * 11. Export Manager Module - Export functionality (ExportManager module)
 * 12. Network Utilities - AJAX wrapper with retry logic (API module)
 * 13. Initialization - Event listeners and initial setup
 */

(function() {
    'use strict';

    // ============================================================================
    // CONFIGURATION & CONSTANTS
    // ============================================================================
    const QUERY_BATCH_SIZE = 500

    // ============================================================================
    // STATE MANAGEMENT
    // ============================================================================
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

    // ============================================================================
    // CACHE SYSTEM
    // ============================================================================
    const chatCache = {
        // Cache for chat lists
        chatList: {
            data: null,
            timestamp: null,
            ttl: 5 * 60 * 1000 // 5 minutes
        },
        // Cache for individual chat messages (keyed by UUID)
        chatMessages: {},
        // Cache for image counts (keyed by UUID)
        imageCounts: {},

        // Check if cached data is still valid
        isValid: function(cacheEntry) {
            if (!cacheEntry || !cacheEntry.timestamp) return false
            const age = Date.now() - cacheEntry.timestamp
            return age < (cacheEntry.ttl || 5 * 60 * 1000)
        },

        // Get cached chat list if valid
        getChatList: function() {
            if (this.isValid(this.chatList)) {
                return this.chatList.data
            }
            return null
        },

        // Set cached chat list
        setChatList: function(data) {
            this.chatList = {
                data: data,
                timestamp: Date.now(),
                ttl: 5 * 60 * 1000
            }
        },

        // Get cached messages for a chat
        getChatMessages: function(uuid) {
            const cached = this.chatMessages[uuid]
            if (this.isValid(cached)) {
                return cached.data
            }
            return null
        },

        // Set cached messages for a chat
        setChatMessages: function(uuid, data) {
            this.chatMessages[uuid] = {
                data: data,
                timestamp: Date.now(),
                ttl: 10 * 60 * 1000 // 10 minutes for individual chats
            }
        },

        // Get cached image count
        getImageCount: function(uuid) {
            const cached = this.imageCounts[uuid]
            if (this.isValid(cached)) {
                return cached.data
            }
            return null
        },

        // Set cached image count
        setImageCount: function(uuid, count) {
            this.imageCounts[uuid] = {
                data: count,
                timestamp: Date.now(),
                ttl: 30 * 60 * 1000 // 30 minutes for image counts (less likely to change)
            }
        },

        // Clear all cache
        clear: function() {
            this.chatList = { data: null, timestamp: null, ttl: 5 * 60 * 1000 }
            this.chatMessages = {}
            this.imageCounts = {}
        },

        // Clear cache for a specific chat
        clearChat: function(uuid) {
            delete this.chatMessages[uuid]
            delete this.imageCounts[uuid]
        }
    }

    // ============================================================================
    // BOOKMARK SYSTEM
    // ============================================================================
    var BookmarkManager = {
        // Get all bookmarked chat UUIDs from localStorage
        getBookmarks: function() {
            try {
                var bookmarksJson = localStorage.getItem('hollyBookmarkedChats');
                if (bookmarksJson) {
                    var bookmarks = JSON.parse(bookmarksJson);
                    return Array.isArray(bookmarks) ? bookmarks : [];
                }
            } catch (e) {
                console.error('Error loading bookmarks:', e);
            }
            return [];
        },

        // Check if a chat is bookmarked
        isBookmarked: function(uuid) {
            var bookmarks = this.getBookmarks();
            return bookmarks.indexOf(uuid) !== -1;
        },

        // Toggle bookmark status for a chat
        toggleBookmark: function(uuid) {
            var bookmarks = this.getBookmarks();
            var index = bookmarks.indexOf(uuid);

            if (index !== -1) {
                // Remove bookmark
                bookmarks.splice(index, 1);
            } else {
                // Add bookmark
                bookmarks.push(uuid);
            }

            // Save to localStorage
            try {
                localStorage.setItem('hollyBookmarkedChats', JSON.stringify(bookmarks));
            } catch (e) {
                console.error('Error saving bookmarks:', e);
            }

            return index === -1; // Returns true if bookmarked, false if unbookmarked
        },

        // Get bookmark count
        getBookmarkCount: function() {
            return this.getBookmarks().length;
        }
    };

    // ============================================================================
    // CHAT MANAGER MODULE
    // ============================================================================
    var ChatManager = {
        // Retrieve chats from API with pagination and caching
        retrieveChatsChunk: function(offset, collected, btn) {
            // Check cache on first chunk (offset 0) - if we have a cached list, use it
            if (offset === 0) {
                var cachedList = chatCache.getChatList();
                if (cachedList && cachedList.length > 0) {
                    // Use cached data
                    collected = cachedList.slice(); // Create a copy

                    // Filter and show immediately
                    btn.busy = false;
                    var textSpan = btn.querySelector('span');
                    if (textSpan) {
                        textSpan.textContent = 'Export Chat/Images';
                    }

                    // Apply filtering if needed
                    var toShow = collected;
                    try {
                        if (window.hollyCurrentChatUuid) {
                            var current = null;
                            for (var i = 0; i < collected.length; i++) {
                                if (collected[i].uuid === window.hollyCurrentChatUuid) {
                                    current = collected[i];
                                    break;
                                }
                            }
                            if (current && current.chars && current.chars.length) {
                                var targetCharUuids = {};
                                for (var j = 0; j < current.chars.length; j++) {
                                    if (current.chars[j].uuid) {
                                        targetCharUuids[current.chars[j].uuid] = true;
                                    }
                                }
                                var uuidCount = Object.keys(targetCharUuids).length;
                                if (uuidCount > 0) {
                                    toShow = [];
                                    for (var k = 0; k < collected.length; k++) {
                                        var chat = collected[k];
                                        if (chat.chars) {
                                            for (var l = 0; l < chat.chars.length; l++) {
                                                if (targetCharUuids[chat.chars[l].uuid]) {
                                                    toShow.push(chat);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {}

                    window.currentChats = toShow;

                    if (toShow.length > 0) {
                        showChatsToDownload(toShow);
                    } else {
                        alert('Unable to find any chats.');
                    }

                    return; // Don't make API call
                }
            }

            API.ajax('https://api.' + location.hostname + '/v1/chats?limit=' + QUERY_BATCH_SIZE + '&offset=' + offset, false, function (r) {
                r = JSON.parse(r);
                if (!r || r.error) {
                    return;
                }

                var cleanChats = r.chats.map(function (chat) {
                    return {
                        uuid: chat.uuid,
                        name: chat.name,
                        date: chat.created_at,
                        imageCount: null, // Will be fetched later
                        chars: chat.characters.map(function (char) {
                            return {
                                name: char.name,
                                uuid: char.uuid,
                                photos: {
                                    thumbnail: char.thumbnail_photo ? (char.thumbnail_photo.url || null) : null,
                                    foreground: char.photos.map(function (photo) { return photo.url; }),
                                    background: char.background_photos.map(function (photo) { return photo.url; })
                                }
                            };
                        })
                    };
                });

                collected = collected.concat(cleanChats);

                if (r.chats.length == QUERY_BATCH_SIZE) {
                    ChatManager.retrieveChatsChunk(offset + QUERY_BATCH_SIZE, collected, btn);
                } else {
                    // Cache the complete chat list
                    chatCache.setChatList(collected);

                    btn.busy = false;
                    // Reset the button text while preserving the SVG icon
                    var textSpan = btn.querySelector('span');
                    if (textSpan) {
                        textSpan.textContent = 'Export Chat/Images';
                    }

                    // If we launched from a chat page, filter chats to only those with the same character(s)
                    var toShow = collected;
                    try {
                        if (window.hollyCurrentChatUuid) {
                            var current = null;
                            for (var i = 0; i < collected.length; i++) {
                                if (collected[i].uuid === window.hollyCurrentChatUuid) {
                                    current = collected[i];
                                    break;
                                }
                            }
                            if (current && current.chars && current.chars.length) {
                                var targetCharUuids = {};
                                for (var j = 0; j < current.chars.length; j++) {
                                    if (current.chars[j].uuid) {
                                        targetCharUuids[current.chars[j].uuid] = true;
                                    }
                                }
                                var uuidCount = Object.keys(targetCharUuids).length;
                                if (uuidCount > 0) {
                                    toShow = [];
                                    for (var k = 0; k < collected.length; k++) {
                                        var chat = collected[k];
                                        if (chat.chars) {
                                            for (var l = 0; l < chat.chars.length; l++) {
                                                if (targetCharUuids[chat.chars[l].uuid]) {
                                                    toShow.push(chat);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {}

                    // Store the list that will actually be rendered so indices match
                    window.currentChats = toShow;

                    if (toShow.length > 0) {
                        showChatsToDownload(toShow);
                    } else {
                        alert('Unable to find any chats.');
                    }
                }
            });
        },

        // Fetch image count for a single chat (lightweight - just counts messages with text_to_image)
        fetchImageCountForChat: function(chatUuid, callback) {
            // Check cache first
            var cachedCount = chatCache.getImageCount(chatUuid);
            if (cachedCount !== null) {
                callback(cachedCount);
                return;
            }

            API.ajax('https://api.' + location.hostname + '/v1/chats/' + chatUuid + '/messages?limit=' + QUERY_BATCH_SIZE + '&offset=0', false, function(r) {
                try {
                    var response = JSON.parse(r);
                    if (!response || response.error) {
                        callback(0);
                        return;
                    }

                    var imageCount = 0;
                    var messages = response.messages || [];

                    // Count messages with text_to_image (this is a batch, may need to fetch more)
                    for (var i = 0; i < messages.length; i++) {
                        if (messages[i].text_to_image) {
                            imageCount++;
                        }
                    }

                    // If there are more messages, fetch them recursively
                    if (messages.length === QUERY_BATCH_SIZE) {
                        ChatManager.fetchImageCountRecursive(chatUuid, QUERY_BATCH_SIZE, imageCount, callback);
                    } else {
                        // Cache and return the final count
                        chatCache.setImageCount(chatUuid, imageCount);
                        callback(imageCount);
                    }
                } catch (e) {
                    console.error('Error fetching image count:', e);
                    callback(0);
                }
            });
        },

        // Recursive helper to fetch remaining messages and count images
        fetchImageCountRecursive: function(chatUuid, offset, currentCount, callback) {
            API.ajax('https://api.' + location.hostname + '/v1/chats/' + chatUuid + '/messages?limit=' + QUERY_BATCH_SIZE + '&offset=' + offset, false, function(r) {
                try {
                    var response = JSON.parse(r);
                    if (!response || response.error) {
                        callback(currentCount);
                        return;
                    }

                    var messages = response.messages || [];
                    var additionalCount = 0;

                    for (var i = 0; i < messages.length; i++) {
                        if (messages[i].text_to_image) {
                            additionalCount++;
                        }
                    }

                    var newCount = currentCount + additionalCount;

                    // If there are more messages, continue fetching
                    if (messages.length === QUERY_BATCH_SIZE) {
                        ChatManager.fetchImageCountRecursive(chatUuid, offset + QUERY_BATCH_SIZE, newCount, callback);
                    } else {
                        // Cache and return the final count
                        chatCache.setImageCount(chatUuid, newCount);
                        callback(newCount);
                    }
                } catch (e) {
                    console.error('Error fetching image count:', e);
                    callback(currentCount);
                }
            });
        },

        // Extract recent chat UUIDs from the DOM (in order)
        extractRecentChatUuids: function() {
            var chatItems = []; // Store {uuid, left} pairs to sort by position

            // Find all links in the recent chats horizontal scroll
            // The structure has divs with position: absolute and left styles indicating order
            var overflowContainers = document.querySelectorAll('div.overflow-hidden');

            for (var c = 0; c < overflowContainers.length; c++) {
                var container = overflowContainers[c];
                // Find all divs with position: absolute (these are the individual chat items)
                var absoluteDivs = container.querySelectorAll('div[style*="position: absolute"]');

                for (var d = 0; d < absoluteDivs.length; d++) {
                    var div = absoluteDivs[d];
                    // Get the left position from the style
                    var style = div.getAttribute('style') || '';
                    var leftMatch = style.match(/left:\s*(\d+)px/);
                    if (!leftMatch) continue;

                    var left = parseInt(leftMatch[1], 10);

                    // Find the link inside this div
                    var link = div.querySelector('a[href^="/tavern/chat/"]');
                    if (!link) continue;

                    var href = link.getAttribute('href');
                    if (!href || href.indexOf('/tavern/chat/') !== 0) continue;

                    // Extract UUID from href
                    var uuidMatch = href.match(/\/tavern\/chat\/([a-f0-9\-]+)/i);
                    if (!uuidMatch || !uuidMatch[1]) continue;

                    var uuid = uuidMatch[1];

                    // Store with left position to preserve order
                    chatItems.push({ uuid: uuid, left: left });
                }

                // If we found items in this container, use them (stop at first non-empty)
                if (chatItems.length > 0) {
                    break;
                }
            }

            // Sort by left position (ascending) to get the correct order
            chatItems.sort(function(a, b) {
                return a.left - b.left;
            });

            // Extract just the UUIDs in order
            var uuids = [];
            for (var i = 0; i < chatItems.length; i++) {
                uuids.push(chatItems[i].uuid);
            }
            return uuids;
        },

        // Fetch image counts for chats that don't have them yet (with rate limiting)
        fetchImageCountsForMissingChats: function(chats, callback, sortSelect) {
            var chatsNeedingCounts = [];
            for (var i = 0; i < chats.length; i++) {
                if (chats[i].imageCount === null) {
                    chatsNeedingCounts.push(chats[i]);
                }
            }

            if (chatsNeedingCounts.length === 0) {
                callback();
                return;
            }

            // Show a loading indicator in the sort dropdown
            if (sortSelect) {
                sortSelect.disabled = true;
                var selectedOption = sortSelect.options[sortSelect.selectedIndex];
                var originalText = selectedOption.textContent;
                selectedOption.textContent = 'Loading image counts...';

                // Fetch counts in batches of 5 with delays to avoid rate limiting
                var batchSize = 5;
                var delayBetweenBatches = 300; // ms
                var completed = 0;
                var total = chatsNeedingCounts.length;

                var processBatch = function(batchIndex) {
                    var batchStart = batchIndex * batchSize;
                    var batchEnd = Math.min(batchStart + batchSize, chatsNeedingCounts.length);
                    var batch = chatsNeedingCounts.slice(batchStart, batchEnd);

                    // Fetch counts for this batch sequentially (ES5 compatible)
                    var batchIndex_inner = 0;
                    var finishBatch = function() {
                        // Update progress
                        var progress = Math.floor((completed / total) * 100);
                        selectedOption.textContent = 'Loading... ' + progress + '%';

                        // If there are more batches, continue
                        if (batchEnd < chatsNeedingCounts.length) {
                            setTimeout(function() {
                                processBatch(batchIndex + 1);
                            }, delayBetweenBatches);
                        } else {
                            // All done - restore sort dropdown and callback
                            sortSelect.disabled = false;
                            selectedOption.textContent = originalText;
                            callback();
                        }
                    };

                    var fetchNext = function() {
                        if (batchIndex_inner >= batch.length) {
                            finishBatch();
                            return;
                        }

                        var chat = batch[batchIndex_inner];
                        ChatManager.fetchImageCountForChat(chat.uuid, function(count) {
                            chat.imageCount = count;
                            completed++;
                            batchIndex_inner++;
                            fetchNext();
                        });
                    };

                    fetchNext();
                };

                // Start processing
                processBatch(0);
            } else {
                // If no sortSelect provided, just fetch all counts without UI updates
                var completed = 0;
                var total = chatsNeedingCounts.length;

                var fetchNext = function(index) {
                    if (index >= chatsNeedingCounts.length) {
                        callback();
                        return;
                    }

                    var chat = chatsNeedingCounts[index];
                    ChatManager.fetchImageCountForChat(chat.uuid, function(count) {
                        chat.imageCount = count;
                        completed++;
                        if (completed >= total) {
                            callback();
                        } else {
                            setTimeout(function() {
                                fetchNext(index + 1);
                            }, 100); // Small delay between requests
                        }
                    });
                };

                fetchNext(0);
            }
        }
    };

    // Backward compatibility wrappers
    function retrieveChatsChunk(offset, collected, btn) {
        return ChatManager.retrieveChatsChunk(offset, collected, btn);
    }
    function fetchImageCountForChat(chatUuid, callback) {
        return ChatManager.fetchImageCountForChat(chatUuid, callback);
    }
    function fetchImageCountRecursive(chatUuid, offset, currentCount, callback) {
        return ChatManager.fetchImageCountRecursive(chatUuid, offset, currentCount, callback);
    }
    function extractRecentChatUuids() {
        return ChatManager.extractRecentChatUuids();
    }

    // ============================================================================
    // THEMING & STYLING
    // ============================================================================
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

    // Add custom scrollbar styles and mobile touch optimizations
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

        /* Mobile touch optimizations */
        @media (max-width: 768px) {
            /* Larger touch targets for buttons */
            .holly-button {
                min-height: 44px !important;
                min-width: 44px !important;
                padding: 12px 16px !important;
            }

            /* Larger touch targets for navigation arrows in image viewer */
            .image-viewer-arrow-left,
            .image-viewer-arrow-right {
                min-width: 64px !important;
                min-height: 64px !important;
                width: 64px !important;
                height: 64px !important;
            }

            /* Larger touch targets for modal controls */
            #holly-metadata-toggle-container {
                min-height: 44px !important;
            }

            .holly-metadata-toggle-switch {
                min-width: 48px !important;
                min-height: 26px !important;
            }

            /* Character icons wrapper max-width on mobile */
            .char-icons-wrapper {
                max-width: 100px !important;
                padding: 20px 0px !important;
            }

            /* Better spacing for touch interactions */
            .comparison-grid > div {
                margin-bottom: 12px !important;
            }

            /* Prevent text selection during swipe */
            .image-viewer-modal img,
            .comparison-grid img {
                -webkit-user-select: none !important;
                -moz-user-select: none !important;
                -ms-user-select: none !important;
                user-select: none !important;
                -webkit-touch-callout: none !important;
            }

            /* Larger clickable areas for modals */
            select, input[type="text"] {
                min-height: 44px !important;
                font-size: 16px !important; /* Prevents zoom on iOS */
            }

            /* Better modal spacing on mobile */
            div[style*="z-index: 110"] > div {
                padding: 16px !important;
                gap: 16px !important;
            }

            /* Better button spacing in modals */
            .image-popup button,
            div[style*="z-index: 110"] button {
                margin: 4px !important;
            }

            /* Improved control row spacing */
            .holly-searchbar-wrap,
            select#holly_sort_chats,
            button#holly_recent_chats_filter,
            button#holly_bookmark_filter {
                margin-bottom: 16px !important;
            }

            /* Better list item spacing for touch */
            ul li {
                padding: 16px !important;
                margin: 12px 0 !important;
            }

            /* Filter buttons alignment and icon size on mobile */
            #holly_recent_chats_filter,
            #holly_bookmark_filter {
                width: 44px !important;
                height: 44px !important;
                min-width: 44px !important;
                min-height: 44px !important;
                padding: 10px !important;
                margin-bottom: 12px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            /* Make icons larger on mobile for filter buttons */
            #holly_recent_chats_filter svg,
            #holly_bookmark_filter svg {
                width: 24px !important;
                height: 24px !important;
                min-width: 24px !important;
                min-height: 24px !important;
            }

            /* Ensure controls row aligns buttons properly on mobile */
            .holly-controls-row {
                align-items: center !important;
            }

            .holly-controls-row > * {
                flex-shrink: 0;
            }
        }
    `
    document.head.appendChild(style)

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    // Body scroll lock utilities
    var bodyScrollLocked = false
    var originalBodyOverflow = ''
    var originalBodyPosition = ''
    var scrollLockOffset = 0

    function lockBodyScroll() {
        if (bodyScrollLocked) return // Already locked
        bodyScrollLocked = true

        var body = document.body
        var html = document.documentElement

        // Save original values
        originalBodyOverflow = body.style.overflow || ''
        originalBodyPosition = body.style.position || ''

        // Calculate current scroll position
        scrollLockOffset = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0

        // Lock scroll
        body.style.overflow = 'hidden'
        body.style.position = 'fixed'
        body.style.width = '100%'
        body.style.top = '-' + scrollLockOffset + 'px'
    }

    function unlockBodyScroll() {
        if (!bodyScrollLocked) return // Not locked
        bodyScrollLocked = false

        var body = document.body

        // Restore original values
        body.style.overflow = originalBodyOverflow
        body.style.position = originalBodyPosition
        body.style.width = ''
        body.style.top = ''

        // Restore scroll position
        if (scrollLockOffset !== undefined) {
            window.scrollTo(0, scrollLockOffset)
        }

        // Reset saved values
        originalBodyOverflow = ''
        originalBodyPosition = ''
        scrollLockOffset = 0
    }
    var Utils = {
    // Optional: tiny progress HUD (add once, reuse)
        makeHud: function() {
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
        },

        // Sanitize filename for safe file saving
        sanitizeFileName: function(s) {
            return (s || 'chat')
                .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120);
        },

        // Escape HTML to prevent XSS
        escapeHtml: function(text) {
            const div = document.createElement('div')
            div.textContent = text
            return div.innerHTML
        },

        // Download file helper
        download: function(path, filename) {
            const anchor = document.createElement('a')
            anchor.href = path
            anchor.download = filename
            document.body.appendChild(anchor)
            anchor.click()
            document.body.removeChild(anchor)
        }
    }

    // Keep backward compatibility
    function makeHud() { return Utils.makeHud() }
    function sanitizeFileName(s) { return Utils.sanitizeFileName(s) }
    function escapeHtml(text) { return Utils.escapeHtml(text) }
    function download(path, filename) { return Utils.download(path, filename) }

    // ============================================================================
    // UI COMPONENTS MODULE
    // ============================================================================
    var UIComponents = {
        // Function to trigger the exporter
        triggerExporter: function() {
            // If we're on a chat page, capture the current chat UUID for filtering
            try {
                var m = location.pathname.match(/\/tavern\/chat\/([a-f0-9\-]+)/i);
                if (m && m[1]) {
                    window.hollyCurrentChatUuid = m[1];
                } else {
                    window.hollyCurrentChatUuid = null;
                }
            } catch (e) {
                window.hollyCurrentChatUuid = null;
            }
            // Create a temporary link element to use with retrieveChatsChunk
            var tempLink = document.createElement('a');
            tempLink.style.display = 'none';
            document.body.appendChild(tempLink);

            if (tempLink.busy) {
                console.log('Exporter already busy');
                return;
            }
            tempLink.busy = true;
            ChatManager.retrieveChatsChunk(0, [], tempLink);
        },

        // Function to add exporter option to chat settings menu
        addExporterToChatMenu: function() {
            // Look for the Headless UI menu items container
            var menuContainer = document.querySelector('[id^="headlessui-menu-items"]');
            if (!menuContainer) return false;

            // Check if we already added the exporter option (but allow re-adding if menu was recreated)
            var existingExporter = menuContainer.querySelector('#holly-exporter-menu-item');
            if (existingExporter) {
                // Item exists, make sure it's still in the right place
                var itemsArray = [];
                var menuItems = menuContainer.querySelectorAll('[role="menuitem"]');
                for (var mi = 0; mi < menuItems.length; mi++) {
                    itemsArray.push(menuItems[mi]);
                }
                var allChatsIndex = -1;
                for (var ai = 0; ai < itemsArray.length; ai++) {
                    var itemText = itemsArray[ai].textContent.trim().toLowerCase();
                    if (itemText.indexOf('all chats') !== -1 || itemText.indexOf('all chat') !== -1) {
                        allChatsIndex = ai;
                        break;
                    }
                }
                var exporterIndex = -1;
                for (var ei = 0; ei < itemsArray.length; ei++) {
                    if (itemsArray[ei].id === 'holly-exporter-menu-item') {
                        exporterIndex = ei;
                        break;
                    }
                }

                // If exporter is not right after "All Chats", remove and re-insert it
                if (allChatsIndex >= 0 && exporterIndex !== allChatsIndex + 1) {
                    existingExporter.remove();
                } else {
                    return false; // Already in correct position
                }
            }

            // Find all existing menu items to understand the structure
            var existingItems = menuContainer.querySelectorAll('[role="menuitem"]');
            if (existingItems.length === 0) return false;

            // Find "All Chats" item to use as a template (it has an icon)
            var allChatsTemplate = null;
            for (var ei = 0; ei < existingItems.length; ei++) {
                var item = existingItems[ei];
                var text = item.textContent.trim().toLowerCase();
                if (text.indexOf('all chats') !== -1 || text.indexOf('all chat') !== -1) {
                    allChatsTemplate = item;
                    break;
                }
            }

            // Use "All Chats" as template if found, otherwise use first item with icon or just first item
            var templateItem = allChatsTemplate;
            if (!templateItem) {
                for (var ti = 0; ti < existingItems.length; ti++) {
                    if (existingItems[ti].querySelector('svg')) {
                        templateItem = existingItems[ti];
                        break;
                    }
                }
            }
            if (!templateItem) {
                templateItem = existingItems[0];
            }

            // Clone the template item to match the structure and styling exactly
            var exporterItem = templateItem.cloneNode(true);
            exporterItem.id = 'holly-exporter-menu-item';

            // Remove any existing headlessui id attribute
            if (exporterItem.id) {
                exporterItem.id = 'holly-exporter-menu-item';
            }

            // Create the download icon SVG
            var downloadIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

            // Replace the icon if one exists, or add it
            var existingIcon = exporterItem.querySelector('svg');

            if (existingIcon) {
                // Replace just the SVG content, preserving harnessing wrapper
                var wrapper = existingIcon.parentElement;
                var wrapperClasses = wrapper ? wrapper.className : '';

                // Create new SVG element with proper namespace
                var newIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                newIcon.setAttribute('width', '24');
                newIcon.setAttribute('height', '24');
                newIcon.setAttribute('viewBox', '0 0 24 24');
                newIcon.setAttribute('fill', 'none');
                newIcon.setAttribute('stroke', 'currentColor');
                newIcon.setAttribute('stroke-width', '2');
                newIcon.setAttribute('stroke-linecap', 'round');
                newIcon.setAttribute('stroke-linejoin', 'round');

                // Add path elements
                var path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path1.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
                newIcon.appendChild(path1);

                var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline.setAttribute('points', '7,10 12,15 17,10');
                newIcon.appendChild(polyline);

                var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', '12');
                line.setAttribute('y1', '15');
                line.setAttribute('x2', '12');
                line.setAttribute('y2', '3');
                newIcon.appendChild(line);

                // Preserve wrapper if it exists, otherwise replace directly
                if (wrapper && wrapper !== exporterItem) {
                    wrapper.innerHTML = '';
                    wrapper.appendChild(newIcon);
                    wrapper.className = wrapperClasses;
                } else {
                    existingIcon.parentNode.replaceChild(newIcon, existingIcon);
                }
            } else {
                // If no icon found, add one at the beginning
                // Look for where icons typically go (first child or specific container)
                var firstChild = exporterItem.firstElementChild;
                if (firstChild && firstChild.classList && firstChild.classList.contains('flex')) {
                    firstChild.insertAdjacentHTML('afterbegin', downloadIcon);
                    var inserted = firstChild.querySelector('svg');
                    if (inserted) {
                        inserted.style.width = '24px';
                        inserted.style.height = '24px';
                        inserted.setAttribute('width', '24');
                        inserted.setAttribute('height', '24');
                    }
                } else {
                    exporterItem.insertAdjacentHTML('afterbegin', downloadIcon);
                    var inserted = exporterItem.querySelector('svg');
                    if (inserted) {
                        inserted.style.width = '24px';
                        inserted.style.height = '24px';
                        inserted.setAttribute('width', '24');
                        inserted.setAttribute('height', '24');
                    }
                }
            }

            // Replace the text content - since we cloned from "All Chats", replace that text
            var textToReplace = 'All Chats';
            var newText = 'Export Chat/Images';

            // Find and replace text nodes, preserving the SVG icon
            // Don't use textContent as it removes the SVG - use TreeWalker instead
            var walker = document.createTreeWalker(
                exporterItem,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            var node;
            while (node = walker.nextNode()) {
                var text = node.textContent.trim();
                // Skip empty text nodes - we want to find actual text content
                if (text && text.length > 0) {
                    // Replace "All Chats" with "Export Chat"
                    var lowerText = text.toLowerCase();
                    if (lowerText.indexOf('all chats') !== -1 || lowerText.indexOf('all chat') !== -1) {
                        node.textContent = text.replace(/All Chats?/i, newText);
                    } else if (text && !node.parentElement.querySelector('svg')) {
                        // If this is text not inside an SVG container, replace it
                        node.textContent = newText;
                    }
                    // Only replace the first meaningful text node
                    break;
                }
            }

            // Ensure proper attributes (should already be set from clone, but make sure)
            exporterItem.setAttribute('role', 'menuitem');
            exporterItem.setAttribute('tabindex', '-1');

            // Ensure left alignment by matching other menu items' structure
            var textElements = exporterItem.querySelectorAll('span, div');
            for (var te = 0; te < textElements.length; te++) {
                var el = textElements[te];
                if (!el.querySelector('svg') && el.textContent.trim()) {
                    el.style.textAlign = 'left';
                }
            }

            // Hover highlight to match native menu behavior
            exporterItem.addEventListener('mouseenter', function () {
                this.style.backgroundColor = '#FFFFFF33';
            });
            exporterItem.addEventListener('mouseleave', function () {
                this.style.backgroundColor = '';
            });

            // Add click handler
            var self = this;
            exporterItem.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();

                // Close the menu first (trigger click on menu button)
                var menuButton = document.querySelector('[id^="headlessui-menu-button"]');
                if (menuButton) {
                    menuButton.click();
                }

                // Small delay to let menu close
                setTimeout(function() {
                    UIComponents.triggerExporter();
                }, 150);
            });

            // Find "All Chats" menu item and insert after it
            var allChatsItem = null;
            var allChatsIndex = -1;

            // Convert NodeList to array for easier manipulation
            var itemsArray = [];
            for (var ia = 0; ia < existingItems.length; ia++) {
                itemsArray.push(existingItems[ia]);
            }

            for (var i = 0; i < itemsArray.length; i++) {
                var item = itemsArray[i];
                var text = item.textContent.trim().toLowerCase();
                if (text.indexOf('all chats') !== -1 || text.indexOf('all chat') !== -1) {
                    allChatsItem = item;
                    allChatsIndex = i;
                    break;
                }
            }

            if (allChatsItem) {
                // Insert immediately after "All Chats" BUT before the divider that follows it
                // This keeps it in the same group as "All Chats"
                var dividerOrNext = allChatsItem.nextElementSibling;
                if (dividerOrNext) {
                    allChatsItem.parentNode.insertBefore(exporterItem, dividerOrNext);
                } else {
                    allChatsItem.insertAdjacentElement('afterend', exporterItem);
                }
            } else {
                // Fallback: insert after existing items (add to the end)
                menuContainer.appendChild(exporterItem);
            }

            return true;
        }
    };

    // Backward compatibility wrappers
    function triggerExporter() {
        return UIComponents.triggerExporter();
    }
    function addExporterToChatMenu() {
        return UIComponents.addExporterToChatMenu();
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================
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

    // ============================================================================
    // SETTINGS MODAL
    // ============================================================================
    function showSettingsModal() {
        // Create backdrop
        var settingsCover = document.createElement('div')
        settingsCover.style.cssText = 'background-color: rgba(0, 0, 0, 0); position: fixed; top: 0; bottom: 0; left: 0; right: 0; z-index: 120; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); transition: background-color 0.3s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease;'

        // Create modal popup
        var settingsPopup = document.createElement('div')
        settingsPopup.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); width: 90vw; max-width: 500px; height: fit-content; background-color: ' + colorScheme.background + '; border-radius: 16px; padding: clamp(16px, 3vw, 32px); display: flex; flex-direction: column; border: 1px solid ' + colorScheme.border + '; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease;'

        // Create header
        var header = document.createElement('div')
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: clamp(16px, 3vw, 24px);'

        var title = document.createElement('h2')
        title.textContent = 'Settings'
        title.style.cssText = 'font-size: clamp(20px, 5vw, 28px); font-weight: 600; color: ' + colorScheme.textPrimary + '; margin: 0;'

        var closeBtn = document.createElement('button')
        closeBtn.innerHTML = '✕'
        closeBtn.style.cssText = 'background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: none; border-radius: 8px; padding: clamp(6px, 1.5vw, 8px) clamp(12px, 3vw, 16px); cursor: pointer; font-weight: 500; transition: background-color 0.2s; font-size: clamp(12px, 3vw, 14px);'
        closeBtn.addEventListener('mouseenter', function() {
            this.style.backgroundColor = colorScheme.hoverBackground;
        })
        closeBtn.addEventListener('mouseleave', function() {
            this.style.backgroundColor = colorScheme.cardBackground;
        })

        header.appendChild(title)
        header.appendChild(closeBtn)
        settingsPopup.appendChild(header)

        // Create toggle container
        var toggleContainer = document.createElement('div')
        toggleContainer.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: clamp(16px, 3vw, 24px); padding: clamp(12px, 2.5vw, 16px); background: ' + colorScheme.cardBackground + '; border-radius: 8px; border: 1px solid ' + colorScheme.border + ';'

        // Create toggle switch
        var toggleSwitch = document.createElement('div')
        toggleSwitch.className = 'holly-auto-close-toggle-switch'
        toggleSwitch.style.cssText = 'width: 48px; height: 26px; background: ' + colorScheme.cardBackground + '; border: 2px solid ' + colorScheme.border + '; border-radius: 13px; position: relative; cursor: pointer; transition: all 0.3s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.3); flex-shrink: 0;'

        var toggleSlider = document.createElement('div')
        toggleSlider.style.cssText = 'width: 20px; height: 20px; background: ' + colorScheme.textSecondary + '; border-radius: 50%; position: absolute; top: 1px; left: 2px; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.4);'

        toggleSwitch.appendChild(toggleSlider)

        // Create label
        var label = document.createElement('span')
        label.textContent = 'Auto-close Download pop-up'
        label.style.cssText = 'color: ' + colorScheme.textPrimary + '; font-size: clamp(14px, 3vw, 16px); cursor: pointer; user-select: none; flex: 1;'

        toggleContainer.appendChild(toggleSwitch)
        toggleContainer.appendChild(label)
        settingsPopup.appendChild(toggleContainer)

        // Load toggle state from localStorage (default to true - auto-close enabled until user sets preference)
        var autoCloseEnabled = localStorage.getItem('hollyAutoCloseProgress') !== 'false'

        // Set initial toggle state
        function updateToggleState(enabled) {
            if (enabled) {
                toggleSwitch.style.background = colorScheme.gradient
                toggleSlider.style.left = '24px'
                toggleSlider.style.background = '#ffffff'
            } else {
                toggleSwitch.style.background = colorScheme.cardBackground
                toggleSlider.style.left = '2px'
                toggleSlider.style.background = colorScheme.textSecondary
            }
        }
        updateToggleState(autoCloseEnabled)

        // Toggle function
        var toggleAutoClose = function() {
            autoCloseEnabled = !autoCloseEnabled
            updateToggleState(autoCloseEnabled)
        }

        toggleSwitch.addEventListener('click', toggleAutoClose)
        label.addEventListener('click', toggleAutoClose)

        // Create button container at bottom
        var buttonContainer = document.createElement('div')
        buttonContainer.style.cssText = 'display: flex; gap: 12px; justify-content: flex-end; margin-top: auto; padding-top: clamp(16px, 3vw, 24px);'

        var saveBtn = document.createElement('button')
        saveBtn.textContent = 'Save'
        saveBtn.style.cssText = 'background: ' + colorScheme.gradient + '; color: black; border: none; border-radius: 8px; padding: clamp(8px, 2vw, 12px) clamp(16px, 4vw, 24px); cursor: pointer; font-weight: 500; font-size: clamp(14px, 3vw, 16px); transition: opacity 0.2s;'
        saveBtn.addEventListener('mouseenter', function() {
            this.style.opacity = '0.9';
        })
        saveBtn.addEventListener('mouseleave', function() {
            this.style.opacity = '1';
        })

        var closeButton = document.createElement('button')
        closeButton.textContent = 'Close'
        closeButton.style.cssText = 'background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 8px; padding: clamp(8px, 2vw, 12px) clamp(16px, 4vw, 24px); cursor: pointer; font-weight: 500; font-size: clamp(14px, 3vw, 16px); transition: background-color 0.2s;'
        closeButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = colorScheme.hoverBackground;
        })
        closeButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = colorScheme.cardBackground;
        })

        buttonContainer.appendChild(saveBtn)
        buttonContainer.appendChild(closeButton)
        settingsPopup.appendChild(buttonContainer)

        settingsCover.appendChild(settingsPopup)
        document.body.appendChild(settingsCover)

        // Function to close settings modal
        var closeSettingsModal = function() {
            settingsCover.style.backgroundColor = 'rgba(0, 0, 0, 0)'
            settingsCover.style.backdropFilter = 'blur(0px)'
            settingsCover.style.webkitBackdropFilter = 'blur(0px)'
            settingsPopup.style.opacity = '0'
            settingsPopup.style.transform = 'translate(-50%, -50%) scale(0.95)'

            setTimeout(function() {
                if (settingsCover && settingsCover.parentNode) {
                    settingsCover.parentNode.removeChild(settingsCover)
                }
            }, 300)
        }

        // Add click handlers
        closeBtn.addEventListener('click', closeSettingsModal)
        closeButton.addEventListener('click', closeSettingsModal)
        settingsCover.addEventListener('click', function(e) {
            if (e.target === settingsCover) {
                closeSettingsModal()
            }
        })

        // ESC key handler
        var escHandler = function(e) {
            if (e.key === 'Escape') {
                closeSettingsModal()
                document.removeEventListener('keydown', escHandler)
            }
        }
        document.addEventListener('keydown', escHandler)

        // Save button handler
        saveBtn.addEventListener('click', function() {
            // Save auto-close preference to localStorage
            localStorage.setItem('hollyAutoCloseProgress', autoCloseEnabled ? 'true' : 'false')
            console.log('Settings saved. Auto-close enabled:', autoCloseEnabled)
            closeSettingsModal()
        })

        // Trigger animation
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                settingsCover.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
                settingsCover.style.backdropFilter = 'blur(4px)'
                settingsCover.style.webkitBackdropFilter = 'blur(4px)'
                settingsPopup.style.opacity = '1'
                settingsPopup.style.transform = 'translate(-50%, -50%) scale(1)'
            })
        })
    }

    // ============================================================================
    // CHAT LIST UI
    // ============================================================================
    function showChatsToDownload(chats)
        {
        var cover = document.createElement('div')
        cover.style.cssText = 'background-color: rgba(0, 0, 0, 0); position: fixed; top: 0; bottom: 0; left: 0; right: 0; z-index: 110; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); transition: background-color 0.3s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease;'

        var popup = document.createElement('div')
        popup.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); width: 90vw; max-width: 1400px; height: fit-content;max-height: 85vh; scroll: auto; background-color: ' + colorScheme.background + '; border-radius: 16px; padding: clamp(16px, 3vw, 32px); display: flex; flex-direction: column; border: 1px solid ' + colorScheme.border + '; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease;'

        // Build dynamic title
        // Default title is "All Chats"
        var titleText = 'All Chats'

        // Create title element with dynamic count (will be updated by updateTitleCount)
        var titleElement = document.createElement('h2')
        titleElement.style.cssText = 'display:block; font-size: clamp(20px, 5vw, 32px); line-height: 1.2; padding-top: 4px; background: ' + colorScheme.textSecondary + '; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-weight: bold; margin-bottom: clamp(10px, 2vw, 20px); white-space: nowrap; overflow: visible; text-overflow: ellipsis; max-width: calc(100% - 64px); padding-right: 16px;'
        titleElement.id = 'holly-chat-list-title'
        titleElement.textContent = titleText + ' (' + chats.length + ')'
        titleElement.title = titleText + ' (' + chats.length + ')'
        popup.appendChild(titleElement)
        cover.appendChild(popup)

        // Lock body scroll when modal opens
        lockBodyScroll()

        // Function to close the modal
        var closeModal = function () {
            // Unlock body scroll when modal closes
            unlockBodyScroll()

            // Start closing animation
            cover.style.backgroundColor = 'rgba(0, 0, 0, 0)'
            cover.style.backdropFilter = 'blur(0px)'
            cover.style.webkitBackdropFilter = 'blur(0px)'
            popup.style.opacity = '0'
            popup.style.transform = 'translate(-50%, -50%) scale(0.95)'

            // Remove from DOM after animation
            setTimeout(function() {
                if (cover && cover.parentNode) {
                    cover.parentNode.removeChild(cover)
                }
            }, 300)
        }

        // Settings button (gear icon)
        var settingsButton = document.createElement('button')
        settingsButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"></path></svg>'
        settingsButton.title = 'Settings'
        settingsButton.style.cssText = 'position: absolute; top: clamp(12px, 2vw, 24px); right: clamp(64px, 12vw, 96px); background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; padding: clamp(6px, 1.5vw, 8px); border-radius: 8px; border: none; cursor: pointer; font-weight: 500; transition: background-color 0.2s, color 0.2s; display: flex; align-items: center; justify-content: center; width: clamp(32px, 8vw, 40px); height: clamp(32px, 8vw, 40px);'
        settingsButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = colorScheme.hoverBackground;
            this.style.color = colorScheme.hoverText;
        })
        settingsButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = colorScheme.cardBackground;
            this.style.color = colorScheme.textPrimary;
        })
        settingsButton.addEventListener('click', function(e) {
            e.stopPropagation();
            showSettingsModal();
        })
        popup.appendChild(settingsButton)

        var closeButton = document.createElement('button')
        closeButton.innerHTML = '✕'
        closeButton.addEventListener('click', closeModal)
        closeButton.style.cssText = 'position: absolute; top: clamp(12px, 2vw, 24px); right: clamp(12px, 2vw, 24px); background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; padding: clamp(6px, 1.5vw, 8px) clamp(12px, 3vw, 14px); border-radius: 8px; border: none; cursor: pointer; font-weight: 500; transition: background-color 0.2s, color 0.2s; font-size: clamp(12px, 3vw, 14px); width: clamp(32px, 8vw, 40px); height: clamp(32px, 8vw, 40px);'
        closeButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = colorScheme.hoverBackground;
            this.style.color = colorScheme.textSecondary;
        })
        closeButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = colorScheme.cardBackground;
            this.style.color = colorScheme.textPrimary;
        })
        popup.appendChild(closeButton)

        // Controls row (format + sort)
        var controlsRow = document.createElement('div')
        controlsRow.className = 'holly-controls-row'
        controlsRow.style.cssText = 'display: flex; gap: 12px; align-items: center; margin-bottom: 0px; flex-wrap: wrap; border-bottom: 1px solid rgb(48, 52, 57); margin-bottom: 4px;'

        var formatSelect = document.createElement('select')
        formatSelect.setAttribute('id', 'holly_download_format')
        formatSelect.style.cssText = 'width: 260px; font-weight: 500; margin-bottom: 0px; background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 8px; padding: 8px 12px; font-size: 14px;'
        var formatOptions = {
            'txt': 'Download as TXT',
            'jsonl-st': 'Download as JSONL (SillyTavern)',
            'jsonl-openai': 'Download as JSONL (OpenAI-Template)',
            'json': 'Download as full JSON',
            'html': 'Download as HTML (with images)'
        }
        for (var key in formatOptions) {
            if (formatOptions.hasOwnProperty(key)) {
                var option = document.createElement('option')
            option.setAttribute('value', key)
                option.innerText = formatOptions[key]
            formatSelect.appendChild(option)
            }
        }

        // We'll place the format selector at the bottom footer instead of top controls

        // Sort dropdown
        var sortSelect = document.createElement('select')
        sortSelect.id = 'holly_sort_chats'
        sortSelect.style.cssText = 'width: 220px; font-weight: 500; margin-bottom: 12px; background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 8px; padding: 8px 12px; font-size: 14px;'

        var sortOptions = [
            { value: 'date_desc', label: 'Sort: Date (Newest first)' },
            { value: 'date_asc', label: 'Sort: Date (Oldest first)' },
            { value: 'name_asc', label: 'Sort: Name (A–Z)' },
            { value: 'name_desc', label: 'Sort: Name (Z–A)' },
            { value: 'chars_asc', label: 'Sort: Character (A–Z)' },
            { value: 'image_count_desc', label: 'Sort: Image Count (Most)' },
            { value: 'image_count_asc', label: 'Sort: Image Count (Least)' }
        ]
        for (var so = 0; so < sortOptions.length; so++) {
            var opt = document.createElement('option')
            opt.value = sortOptions[so].value
            opt.textContent = sortOptions[so].label
            sortSelect.appendChild(opt)
        }
        // Search input (Moescape-like)
        var searchWrap = document.createElement('div')
        searchWrap.className = 'holly-searchbar-wrap'
        searchWrap.style.cssText = 'display: flex; align-items: center; gap: 8px; width: clamp(200px, 40vw, 420px); max-width: 40%; min-width: 410px; width: -webkit-fill-available; margin-bottom: 12px; background: ' + colorScheme.cardBackground + '; border: 1px solid ' + colorScheme.border + '; border-radius: 10px; padding: 8px 12px; transition: border-color .15s ease, box-shadow .15s ease;'

        // Add responsive styles for mobile
        if (!document.getElementById('holly-searchbar-responsive')) {
            var searchBarResponsive = document.createElement('style')
            searchBarResponsive.id = 'holly-searchbar-responsive'
            searchBarResponsive.textContent = '@media (max-width: 768px) { .holly-searchbar-wrap { min-width: 0 !important; max-width: 100% !important; width: 100% !important; box-sizing: border-box !important; } }'
            document.head.appendChild(searchBarResponsive)
        }

        var searchIcon = document.createElement('span')
        searchIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:' + colorScheme.textPrimary + ';opacity:.9"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
        var searchInput = document.createElement('input')
        searchInput.type = 'text'
        searchInput.placeholder = 'Search'
        searchInput.style.cssText = 'flex:1; background: transparent; color: ' + colorScheme.textPrimary + '; border: none; outline: none; font-size: 14px; caret-color: ' + colorScheme.hoverText + ';'
        searchWrap.appendChild(searchIcon)
        searchWrap.appendChild(searchInput)
        // Extract recent chat UUIDs from DOM
        var recentChatUuids = ChatManager.extractRecentChatUuids();

        // Recent Chats Only filter button (clock icon only)
        var recentChatsFilterBtn = document.createElement('button')
        recentChatsFilterBtn.id = 'holly_recent_chats_filter'
        recentChatsFilterBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.8022 0.0155546C14.6994 0.0280055 14.4112 0.0632655 14.1617 0.0939098C9.72698 0.638424 5.8439 3.85071 4.40211 8.1677C4.19324 8.7932 3.91312 9.94201 3.91312 10.1733V10.2876H2.13841H0.363647L2.48536 12.4208L4.60703 14.554L6.72869 12.4208L8.85041 10.2876H7.23156H5.61272L5.6472 10.1132C6.16486 7.49508 7.55413 5.27452 9.65262 3.71107C12.3003 1.73845 15.7413 1.18326 18.9123 2.21696C19.6602 2.46077 20.8439 3.05369 21.5011 3.51373C22.9824 4.55059 24.06 5.80197 24.8617 7.41635C25.6003 8.90375 25.9563 10.396 25.9563 12.005C25.9563 13.6139 25.6003 15.1061 24.8617 16.5935C24.0722 18.1832 23.045 19.387 21.5765 20.4434C20.9531 20.8918 19.6563 21.5485 18.9123 21.7925C15.6939 22.8479 12.2312 22.2637 9.50962 20.206C8.98759 19.8114 8.26629 19.1251 7.91181 18.6858L7.63537 18.3432L7.12203 18.7422C6.83972 18.9616 6.53754 19.1989 6.45054 19.2695L6.29233 19.3978L6.44568 19.6057C6.74262 20.0084 8.00282 21.2232 8.53831 21.6228C10.1584 22.832 11.9442 23.5834 13.9482 23.899C14.7956 24.0325 16.5632 24.0339 17.4177 23.9018C18.2081 23.7796 19.1661 23.5365 19.8143 23.2937C23.4949 21.9151 26.2821 18.8341 27.2606 15.0624C27.5552 13.9271 27.6364 13.2666 27.6364 12.005C27.6364 10.7433 27.5552 10.0828 27.2606 8.94749C26.2833 5.18055 23.4821 2.08386 19.8143 0.715437C19.1775 0.477849 18.2076 0.230441 17.4711 0.117738C16.9327 0.0353045 15.1898 -0.0314048 14.8022 0.0155546ZM14.0015 9.94046C14.0015 12.4693 14.015 13.0594 14.0763 13.2008C14.1182 13.2976 15.1091 14.3343 16.3321 15.5608L18.5131 17.7481L19.1127 17.1434L19.7124 16.5388L17.711 14.5271L15.7096 12.5153V9.68409V6.85284H14.8556H14.0015V9.94046Z" fill="currentColor"></path></svg>'
        recentChatsFilterBtn.title = recentChatUuids.length > 0 ? 'Recent Chats Only' : 'Recent Chats Only (N/A)'
        recentChatsFilterBtn.style.cssText = 'font-weight: 500; margin-bottom: 12px; background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 8px; padding: 8px; font-size: 14px; cursor: pointer; transition: all 0.2s; white-space: nowrap; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;'
        if (recentChatUuids.length === 0) {
            recentChatsFilterBtn.disabled = true
            recentChatsFilterBtn.style.opacity = '0.5'
            recentChatsFilterBtn.style.cursor = 'not-allowed'
        }

        var isRecentChatsFilterActive = false

        recentChatsFilterBtn.addEventListener('click', function() {
            if (recentChatUuids.length === 0) return
            isRecentChatsFilterActive = !isRecentChatsFilterActive

            if (isRecentChatsFilterActive) {
                // Deactivate bookmark filter if it was active
                if (isBookmarkFilterActive) {
                    isBookmarkFilterActive = false
                    bookmarkFilterBtn.style.background = colorScheme.cardBackground
                    bookmarkFilterBtn.style.color = colorScheme.textPrimary
                }

                this.style.background = colorScheme.gradient
                this.style.color = 'black'
                // Hide sort dropdown when recent chats filter is active (sorting is disabled)
                sortSelect.style.display = 'none'
            } else {
                this.style.background = colorScheme.cardBackground
                this.style.color = colorScheme.textPrimary
                // Show sort dropdown only if bookmark filter is also inactive
                if (!isBookmarkFilterActive) {
                    sortSelect.style.display = ''
                }
            }

            recomputeList()
            updateTitleCount() // Update title when filter toggles
        })

        recentChatsFilterBtn.addEventListener('mouseenter', function() {
            if (!this.disabled && !isRecentChatsFilterActive) {
                this.style.backgroundColor = colorScheme.hoverBackground
                this.style.color = colorScheme.hoverText
            }
        })
        recentChatsFilterBtn.addEventListener('mouseleave', function() {
            if (!this.disabled && !isRecentChatsFilterActive) {
                this.style.backgroundColor = colorScheme.cardBackground
                this.style.color = colorScheme.textPrimary
            }
        })

        // Bookmark filter button (bookmark icon only)
        var bookmarkFilterBtn = document.createElement('button')
        bookmarkFilterBtn.id = 'holly_bookmark_filter'
        var bookmarkCount = BookmarkManager.getBookmarkCount()
        bookmarkFilterBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'
        bookmarkFilterBtn.title = 'Bookmarks'
        bookmarkFilterBtn.style.cssText = 'font-weight: 500; margin-bottom: 12px; background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 8px; padding: 8px; font-size: 14px; cursor: pointer; transition: all 0.2s; white-space: nowrap; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;'
        if (bookmarkCount === 0) {
            bookmarkFilterBtn.disabled = true
            bookmarkFilterBtn.style.opacity = '0.5'
            bookmarkFilterBtn.style.cursor = 'not-allowed'
        }

        var isBookmarkFilterActive = false

        bookmarkFilterBtn.addEventListener('click', function(e) {
            // Prevent clicks if button is disabled
            if (this.disabled) {
                e.preventDefault()
                e.stopPropagation()
                return false
            }

            // Check bookmark count dynamically in case it changed
            var currentBookmarkCount = BookmarkManager.getBookmarkCount()
            if (currentBookmarkCount === 0) {
                // If no bookmarks, ensure filter is inactive
                isBookmarkFilterActive = false
                this.style.background = colorScheme.cardBackground
                this.style.color = colorScheme.textPrimary
                if (sortSelect) sortSelect.style.display = ''
                recomputeList()
                updateTitleCount()
                return
            }

            // Toggle bookmark filter
            isBookmarkFilterActive = !isBookmarkFilterActive

            if (isBookmarkFilterActive) {
                // Deactivate recent chats filter if it was active
                if (isRecentChatsFilterActive) {
                    isRecentChatsFilterActive = false
                    recentChatsFilterBtn.style.background = colorScheme.cardBackground
                    recentChatsFilterBtn.style.color = colorScheme.textPrimary
                }

                this.style.background = colorScheme.gradient
                this.style.color = 'black'
                // Hide sort dropdown when bookmark filter is active (similar to recent chats)
                sortSelect.style.display = 'none'
            } else {
                this.style.background = colorScheme.cardBackground
                this.style.color = colorScheme.textPrimary
                // Show sort dropdown only if recent chats filter is also inactive
                if (!isRecentChatsFilterActive) {
                    sortSelect.style.display = ''
                }
            }

            recomputeList()
            updateTitleCount() // Update title when filter toggles
        })

        bookmarkFilterBtn.addEventListener('mouseenter', function() {
            if (!this.disabled && !isBookmarkFilterActive) {
                this.style.backgroundColor = colorScheme.hoverBackground
                this.style.color = colorScheme.hoverText
            }
        })
        bookmarkFilterBtn.addEventListener('mouseleave', function() {
            if (!this.disabled && !isBookmarkFilterActive) {
                this.style.backgroundColor = colorScheme.cardBackground
                this.style.color = colorScheme.textPrimary
            }
        })

        // Add search first, then sort, then recent chats filter, then bookmark filter
        controlsRow.appendChild(searchWrap)
        controlsRow.appendChild(sortSelect)
        controlsRow.appendChild(recentChatsFilterBtn)
        controlsRow.appendChild(bookmarkFilterBtn)

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

        // Virtual scrolling state
        const ITEMS_PER_BATCH = 50 // Render 50 items at a time
        const BUFFER_SIZE = 20 // Extra items to render before scroll reaches them
        let renderedStartIndex = 0
        let renderedEndIndex = ITEMS_PER_BATCH
        let sentinel = null // IntersectionObserver sentinel element
        let observer = null

        function renderChatList() {
            // Keep global reference aligned with current rendered order for image lookups
            try { window.currentChats = workingChats } catch (_) {}

            // Reset virtual scrolling when list changes
            renderedStartIndex = 0
            renderedEndIndex = Math.min(ITEMS_PER_BATCH, workingChats.length)

            // Disconnect previous observer if exists
            if (observer) {
                observer.disconnect()
                observer = null
            }

            // Clear list
            list.innerHTML = ''

            // For small lists (< 100 items), render all at once (no need for virtual scrolling)
            if (workingChats.length <= 100) {
                renderChatItems(0, workingChats.length)
                return
            }

            // For large lists, use virtual scrolling
            renderChatItems(0, renderedEndIndex)
            setupInfiniteScroll()
        }

        function renderChatItems(startIdx, endIdx) {
            // Ensure we don't go beyond array bounds
            const actualEnd = Math.min(endIdx, workingChats.length)

            for (var i = startIdx; i < actualEnd; i++)
                {
                var chatData = workingChats[i]
                var chatEntry = document.createElement('li')
                chatEntry.style.cssText = 'margin: 8px 0; padding: 12px; display: flex; flex-direction: column; gap: 12px; border-bottom: solid 1px ' + colorScheme.border + '; position: relative; background: ' + colorScheme.cardBackground + '; border-radius: 8px; transition: background-color 0.2s;'
            chatEntry.addEventListener('mouseenter', function() { this.style.backgroundColor = colorScheme.hoverBackground; })
            chatEntry.addEventListener('mouseleave', function() { this.style.backgroundColor = colorScheme.cardBackground; })

            // Create top row container for name/date and icons
            var topRowContainer = document.createElement('div')
            topRowContainer.style.cssText = 'display: flex; align-items: center; gap: 12px; justify-content: space-between; margin: -22px 0;'

            // Create wrapper for fade effect
            var charIconsWrapper = document.createElement('div')
            charIconsWrapper.className = 'char-icons-wrapper'
            // overflow: visible allows glow effects to show, padding adds space for glow (box-shadow extends 12px + 4px offset)
            charIconsWrapper.style.cssText = 'position: relative; max-width: 320px; flex-shrink: 0; overflow: hidden; padding: 20px 20px;'

            // Create character icons container - horizontally scrollable list
            var charIconsContainer = document.createElement('div')
            var numChars = chatData.chars.length
            // Add class to identify single vs multiple character chats
            if (numChars === 1) {
                charIconsContainer.className = 'char-icons-container char-icons-single'
            } else {
                charIconsContainer.className = 'char-icons-container char-icons-multiple'
            }
            // Max width: 1.25 character icons (56px icon + 8px gap + 14px partial icon = 78px)
            // overflow-y: visible allows glow effect to show, padding adds space for glow (box-shadow extends 12px + 4px offset)
            // Hide scrollbar for single character chats
            var scrollbarStyle = numChars === 1 ? 'scrollbar-width: none;' : 'scrollbar-width: thin;'
            charIconsContainer.style.cssText = 'display: flex; gap: 8px; overflow-x: ' + (numChars === 1 ? 'hidden' : 'auto') + '; overflow-y: hidden; align-items: center; max-width: 100%; ' + scrollbarStyle + ' -webkit-overflow-scrolling: touch; padding: 12px 0; scale: 1.25;'

            // Hide scrollbar and add fade effects
            if (!document.getElementById('char-icons-scroll-style')) {
                var scrollStyle = document.createElement('style')
                scrollStyle.id = 'char-icons-scroll-style'
                // Match export list scrollbar styling (8px height, 4px border-radius)
                scrollStyle.textContent = '.char-icons-container::-webkit-scrollbar { height: 8px; } .char-icons-container::-webkit-scrollbar-track { background: transparent; } .char-icons-container::-webkit-scrollbar-thumb { background: ' + colorScheme.border + '; border-radius: 4px; } .char-icons-container::-webkit-scrollbar-thumb:hover { background: ' + colorScheme.cardBackground + '; } .char-icons-single::-webkit-scrollbar { display: none; } .char-icons-single { -ms-overflow-style: none; scrollbar-width: none; } .char-icons-wrapper::before, .char-icons-wrapper::after { content: ""; position: absolute; top: 0; bottom: 0; width: 12px; pointer-events: none; z-index: 1; overflow: visible; } .char-icons-wrapper { overflow: visible; } .char-icons-wrapper::before { margin-bottom: 10px; margin-top: 10px; left: 0; background: linear-gradient(to right, ' + colorScheme.cardBackground + ', transparent); } .char-icons-wrapper::after { margin-bottom: 10px; margin-top: 10px; right: 0; background: linear-gradient(to left, ' + colorScheme.cardBackground + ', transparent); }'
                document.head.appendChild(scrollStyle)
            }

            charIconsWrapper.appendChild(charIconsContainer)

            // Add character icons
            chatData.chars.forEach(function(char, charIndex) {
                // Create clickable link wrapper
                var charLink = document.createElement('a')
                // Use different URL formats for different sites
                if (isMoescape) {
                    charLink.href = 'https://moescape.ai/tavern/characters/' + char.uuid
                } else {
                    charLink.href = 'https://yodayo.com/tavern/characters/' + char.uuid
                }
                charLink.target = '_blank'
                // Add padding-left and drop-shadow to first icon to align with single icon chats
                var linkStyle = 'text-decoration: none; cursor: pointer; flex-shrink: 0;'
                if (charIndex === 0) {
                    linkStyle += ' padding-left: 44px;'
                }
                charLink.style.cssText = linkStyle
                charLink.title = 'View ' + char.name + '\'s profile'

                var charIcon = document.createElement('div')
                // Fixed size for all icons - consistent across desktop and mobile
                var iconSize = '56px'
                charIcon.style.cssText = 'width: ' + iconSize + '; height: ' + iconSize + '; border-radius: 50%; border: 2px solid ' + colorScheme.border + '; overflow: hidden; flex-shrink: 0; background: ' + colorScheme.cardBackground + '; display: flex; align-items: center; justify-content: center; transition: transform 0.2s, box-shadow 0.2s;'
                charIcon.title = char.name

                // Add hover effect
                charLink.addEventListener('mouseenter', function() {
                    charIcon.style.transform = 'scale(1.05)'
                    charIcon.style.boxShadow = '0 4px 8px ' + colorScheme.glowColor
                })
                charLink.addEventListener('mouseleave', function() {
                    charIcon.style.transform = 'scale(1)'
                    charIcon.style.boxShadow = 'none'
                })

                if (char.photos && char.photos.thumbnail) {
                    // Use thumbnail photo if available
                    charIcon.innerHTML = '<img src="' + char.photos.thumbnail + '" style="width: 100%; height: 100%; object-fit: cover;">'
                } else if (char.photos && char.photos.foreground && char.photos.foreground.length > 0) {
                    // Fallback to first foreground photo if no thumbnail
                    charIcon.innerHTML = '<img src="' + char.photos.foreground[0] + '" style="width: 100%; height: 100%; object-fit: cover;">'
                }
                // If no photos available, leave the icon empty (just the background)

                charLink.appendChild(charIcon)
                charIconsContainer.appendChild(charLink)
            })

            // Create container for name and date
            var nameDateContainer = document.createElement('div')
            nameDateContainer.style.cssText = 'display: flex; flex-direction: column; flex: 1; gap: 4px; min-width: 0;'

            // Create clickable link for the chat name
            var charsLink = document.createElement('a')
            charsLink.href = chatData.uuid ? (isMoescape ? 'https://moescape.ai/tavern/chat/' + chatData.uuid : 'https://yodayo.com/tavern/chat/' + chatData.uuid) : '#'
            charsLink.target = '_blank'
            charsLink.style.cssText = 'color: ' + colorScheme.textPrimary + '; font-weight: 500; font-size: 14px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; cursor: pointer; text-decoration: none;'
            var charNames = []
            for (var cn = 0; cn < chatData.chars.length; cn++) {
                charNames.push(chatData.chars[cn].name)
            }
            charsLink.innerHTML = charNames.join(', ')
            // Add hover effect
            charsLink.addEventListener('mouseenter', function() { this.style.color = colorScheme.hoverText; })
            charsLink.addEventListener('mouseleave', function() { this.style.color = colorScheme.textPrimary; })
            nameDateContainer.appendChild(charsLink)

            var dateLabel = document.createElement('label')
            dateLabel.style.cssText = 'white-space: nowrap; color: ' + colorScheme.textSecondary + '; font-size: 12px;'
            dateLabel.innerHTML = chatData.date.substr(0, 10)
            nameDateContainer.appendChild(dateLabel)

            topRowContainer.appendChild(nameDateContainer)
            topRowContainer.appendChild(charIconsWrapper)

            chatEntry.appendChild(topRowContainer)

            // Create button container
            var buttonContainer = document.createElement('div')
            buttonContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; flex-shrink: 0;'

            var downloadButton = document.createElement('button')
            downloadButton.innerText = 'Download'
            // Store UUID in data attribute to avoid closure issues
            downloadButton.setAttribute('data-chat-uuid', chatData.uuid)
            downloadButton.style.cssText = 'background: ' + colorScheme.gradient + '; color: black; padding: clamp(8px, 2vw, 10px) clamp(12px, 3vw, 16px); border-radius: 8px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s; font-size: clamp(12px, 3vw, 14px); min-width: 80px;'
            downloadButton.addEventListener('mouseenter', function() { this.style.background = isYodayo ? '#151820' : '#1A1C1E'; })
            downloadButton.addEventListener('mouseenter', function() { this.style.color = colorScheme.hoverText; })
            downloadButton.addEventListener('mouseleave', function() { this.style.background = colorScheme.gradient; })
            downloadButton.addEventListener('mouseleave', function() { this.style.color = 'black'; })
            downloadButton.addEventListener('click', function ()
                {
                closeImagePopup()

                if (this.busy)
                    {
                    console.log('Button click ignored - already busy')
                    return
                    }

                this.busy = true
                this.innerText = '(Processing...)'
                this.style.background = '#6b7280'

                // Get UUID from button's data attribute to avoid closure issues
                var uuid = this.getAttribute('data-chat-uuid')
                retrieveConversationChunk(uuid, 0, [], this)
                })
            buttonContainer.appendChild(downloadButton)

            var photoButton = document.createElement('button')
            photoButton.innerText = 'Images'
            // Store UUID and index in data attributes to avoid closure issues
            photoButton.setAttribute('data-chat-uuid', chatData.uuid)
            photoButton.setAttribute('data-chat-index', i)
            photoButton.style.cssText = 'background: ' + colorScheme.gradient + '; color: black; padding: clamp(8px, 2vw, 10px) clamp(12px, 3vw, 16px); border-radius: 8px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s; font-size: clamp(12px, 3vw, 14px); min-width: 80px;'
            photoButton.addEventListener('mouseenter', function() { this.style.background = isYodayo ? '#151820' : '#1A1C1E'; })
            photoButton.addEventListener('mouseenter', function() { this.style.color = colorScheme.hoverText; })
            photoButton.addEventListener('mouseleave', function() { this.style.background = colorScheme.gradient; })
            photoButton.addEventListener('mouseleave', function() { this.style.color = 'black'; })
            photoButton.addEventListener('click', function ()
                {
                if (this.busy)
                    {
                    console.log('Images button click ignored - already busy')
                    return
                    }

                this.busy = true
                this.innerText = '(Loading...)'
                this.style.background = '#6b7280'

                // Get UUID and index from button's data attributes to avoid closure issues
                var uuid = this.getAttribute('data-chat-uuid')
                var chatIndex = parseInt(this.getAttribute('data-chat-index'), 10)
                retrieveConversationChunk(uuid, 0, [], this, chatIndex)
                })
            buttonContainer.appendChild(photoButton)

            // Bookmark button
            var bookmarkButton = document.createElement('button')
            bookmarkButton.className = 'holly-bookmark-btn'
            bookmarkButton.setAttribute('data-chat-uuid', chatData.uuid)
            var isBookmarked = BookmarkManager.isBookmarked(chatData.uuid)

            // Create SVG bookmark icon
            var bookmarkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            bookmarkIcon.setAttribute('width', '16')
            bookmarkIcon.setAttribute('height', '16')
            bookmarkIcon.setAttribute('viewBox', '0 0 24 24')
            bookmarkIcon.setAttribute('fill', isBookmarked ? 'currentColor' : 'none')
            bookmarkIcon.setAttribute('stroke', 'currentColor')
            bookmarkIcon.setAttribute('stroke-width', '2')
            bookmarkIcon.setAttribute('stroke-linecap', 'round')
            bookmarkIcon.setAttribute('stroke-linejoin', 'round')
            bookmarkIcon.style.cssText = 'display: block;'

            var bookmarkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            bookmarkPath.setAttribute('d', 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z')
            bookmarkIcon.appendChild(bookmarkPath)

            bookmarkButton.appendChild(bookmarkIcon)
            var bookmarkColor = isBookmarked ? colorScheme.textSecondary : colorScheme.accent
            bookmarkButton.style.cssText = 'background: transparent; color: ' + bookmarkColor + '; border: 2px solid ' + bookmarkColor + '; border-radius: 8px; padding: clamp(6px, 1.5vw, 8px); cursor: pointer; font-weight: 500; transition: all 0.2s; display: flex; align-items: center; justify-content: center; min-width: 36px; min-height: 36px;'
            bookmarkButton.title = isBookmarked ? 'Remove bookmark' : 'Bookmark chat'

            bookmarkButton.addEventListener('click', function(e) {
                e.stopPropagation()
                // Get UUID from button's data attribute to avoid closure issues
                var uuid = this.getAttribute('data-chat-uuid')
                var nowBookmarked = BookmarkManager.toggleBookmark(uuid)

                // Get the bookmark path element from this button
                var btnPath = this.querySelector('path')

                // Update button appearance
                if (nowBookmarked) {
                    this.style.color = colorScheme.textSecondary
                    this.style.borderColor = colorScheme.textSecondary
                    if (btnPath) btnPath.setAttribute('fill', 'currentColor')
                    this.title = 'Remove bookmark'
                } else {
                    this.style.color = colorScheme.accent
                    this.style.borderColor = colorScheme.accent
                    if (btnPath) btnPath.setAttribute('fill', 'none')
                    this.title = 'Bookmark chat'
                }

                // Update bookmark filter button state if needed
                var newCount = BookmarkManager.getBookmarkCount()
                var filterBtn = document.getElementById('holly_bookmark_filter')
                if (filterBtn) {
                    if (newCount === 0) {
                        filterBtn.disabled = true
                        filterBtn.style.opacity = '0.5'
                        filterBtn.style.cursor = 'not-allowed'

                        // Check if bookmark filter is active by checking if sort dropdown is hidden
                        // (bookmark filter hides sort dropdown, but so does recent filter)
                        var sortSelect = document.getElementById('holly_sort_chats')
                        var recentBtn = document.getElementById('holly_recent_chats_filter')
                        var recentActive = false
                        if (recentBtn) {
                            // Check if recent button has gradient background (active state)
                            var recentBg = recentBtn.style.background || recentBtn.style.backgroundColor || ''
                            recentActive = recentBg.indexOf(colorScheme.gradient) !== -1
                        }

                        // If sort is hidden and recent is NOT active, then bookmark filter must be active
                        if (sortSelect && sortSelect.style.display === 'none' && !recentActive) {
                            // Deactivate bookmark filter and show all chats
                            // renderChatItems is inside showChatsToDownload scope, so isBookmarkFilterActive is accessible
                            isBookmarkFilterActive = false
                            filterBtn.style.background = colorScheme.cardBackground
                            filterBtn.style.color = colorScheme.textPrimary
                            sortSelect.style.display = ''

                            // Trigger recompute to show all chats - these functions are in parent scope
                            recomputeList()
                            updateTitleCount()
                        } else {
                            // Just update title count if filter wasn't active
                            updateTitleCount()
                        }
                    } else {
                        filterBtn.disabled = false
                        filterBtn.style.opacity = '1'
                        filterBtn.style.cursor = 'pointer'

                        // If bookmark filter is active, recompute the list (which will update title count)
                        if (typeof recomputeList === 'function') {
                            recomputeList()
                        } else if (typeof updateTitleCount === 'function') {
                            updateTitleCount()
                        }
                    }
                }
            })

            bookmarkButton.addEventListener('mouseenter', function() {
                if (!BookmarkManager.isBookmarked(chatData.uuid)) {
                    this.style.backgroundColor = colorScheme.accent + '20'
                } else {
                    this.style.backgroundColor = colorScheme.textSecondary + '20'
                }
            })
            bookmarkButton.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent'
            })

            buttonContainer.appendChild(bookmarkButton)

            chatEntry.appendChild(buttonContainer)

            list.appendChild(chatEntry)
            }
        }

        // Setup infinite scroll with IntersectionObserver
        function setupInfiniteScroll() {
            // Remove old sentinel if exists
            if (sentinel && sentinel.parentNode) {
                sentinel.remove()
            }

            // Only setup if there are more items to load
            if (renderedEndIndex >= workingChats.length) {
                return // All items already rendered
            }

            // Create sentinel element at the bottom of the list
            sentinel = document.createElement('div')
            sentinel.className = 'holly-scroll-sentinel'
            sentinel.style.cssText = 'height: 20px; width: 100%;'
            list.appendChild(sentinel)

            // Setup IntersectionObserver to detect when sentinel comes into view
            observer = new IntersectionObserver(function(entries) {
                for (var ent = 0; ent < entries.length; ent++) {
                    var entry = entries[ent];
                    if (entry.isIntersecting && renderedEndIndex < workingChats.length) {
                        // Load more items
                        var oldEnd = renderedEndIndex;
                        renderedEndIndex = Math.min(renderedEndIndex + ITEMS_PER_BATCH, workingChats.length);

                        // Render new batch
                        renderChatItems(oldEnd, renderedEndIndex);

                        // Re-setup observer for new sentinel position
                        if (renderedEndIndex < workingChats.length) {
                            setupInfiniteScroll();
                        } else {
                            // All items loaded, remove sentinel
                            if (sentinel && sentinel.parentNode) {
                                sentinel.remove();
                            }
                            if (observer) {
                                observer.disconnect();
                                observer = null;
                            }
                        }
                    }
                }
            }, {
                root: list,
                rootMargin: '100px', // Start loading 100px before sentinel is visible
                threshold: 0.1
            })

            observer.observe(sentinel)
        }

        // Recompute from original -> filter -> sort -> render
        function recomputeList() {
            // Filter by search
            var q = currentSearch
            var filtered = originalChats
            if (q) {
                filtered = []
                for (var f = 0; f < originalChats.length; f++) {
                    var chat = originalChats[f]
                    var name = (chat.name || '')
                    var charNames = []
                    if (chat.chars && Array.isArray(chat.chars)) {
                        for (var cn = 0; cn < chat.chars.length; cn++) {
                            charNames.push(chat.chars[cn].name)
                        }
                    }
                    var chars = charNames.join(' ')
                    var searchText = (name + ' ' + chars).toLowerCase()
                    if (searchText.indexOf(q) !== -1) {
                        filtered.push(chat)
                    }
                }
            }

            // Filter by bookmark if active
            if (isBookmarkFilterActive) {
                var bookmarkedUuids = BookmarkManager.getBookmarks();
                var bookmarkedUuidsSet = {};
                for (var bu = 0; bu < bookmarkedUuids.length; bu++) {
                    bookmarkedUuidsSet[bookmarkedUuids[bu]] = true;
                }
                // Filter to only bookmarked chats
                filtered = filtered.filter(function(chat) {
                    return bookmarkedUuidsSet[chat.uuid] === true;
                });
            }

            // Filter by recent chats if active (bookmark filter takes precedence)
            if (isRecentChatsFilterActive && recentChatUuids.length > 0 && !isBookmarkFilterActive) {
                // Create an object for fast lookup
                var recentChatUuidsSet = {}
                for (var ru = 0; ru < recentChatUuids.length; ru++) {
                    recentChatUuidsSet[recentChatUuids[ru]] = true
                }
                // Filter to only recent chats
                var recentFiltered = []
                for (var rf = 0; rf < filtered.length; rf++) {
                    if (recentChatUuidsSet[filtered[rf].uuid] === true) {
                        recentFiltered.push(filtered[rf])
                    }
                }
                filtered = recentFiltered

                // Sort by the order in recentChatUuids array (preserve DOM order)
                filtered.sort(function(a, b) {
                    var indexA = recentChatUuids.indexOf(a.uuid)
                    var indexB = recentChatUuids.indexOf(b.uuid)
                    // If UUID not found in recent list, put at end
                    if (indexA === -1) return 1
                    if (indexB === -1) return -1
                    return indexA - indexB
                })
            }

            // Apply sort (unless we're filtering by recent chats, which preserves DOM order)
            workingChats = filtered.slice()

            // Only apply sort if recent chats filter and bookmark filter are not active (preserve DOM order when filtering)
            if (!isRecentChatsFilterActive && !isBookmarkFilterActive) {
            switch (currentSort) {
                case 'date_asc':
                    workingChats.sort(function(a,b) {
                        return new Date(a.date) - new Date(b.date);
                    });
                    break
                case 'name_asc':
                    workingChats.sort(function(a,b) {
                        var nameA = []
                        var nameB = []
                        if (a.chars && Array.isArray(a.chars)) {
                            for (var na = 0; na < a.chars.length; na++) {
                                nameA.push(a.chars[na].name)
                            }
                        }
                        if (b.chars && Array.isArray(b.chars)) {
                            for (var nb = 0; nb < b.chars.length; nb++) {
                                nameB.push(b.chars[nb].name)
                            }
                        }
                        return nameA.join(', ').localeCompare(nameB.join(', '))
                    })
                    break
                case 'name_desc':
                    workingChats.sort(function(a,b) {
                        var nameA = []
                        var nameB = []
                        if (a.chars && Array.isArray(a.chars)) {
                            for (var na = 0; na < a.chars.length; na++) {
                                nameA.push(a.chars[na].name)
                            }
                        }
                        if (b.chars && Array.isArray(b.chars)) {
                            for (var nb = 0; nb < b.chars.length; nb++) {
                                nameB.push(b.chars[nb].name)
                            }
                        }
                        return nameB.join(', ').localeCompare(nameA.join(', '))
                    })
                    break
                case 'chars_asc':
                    workingChats.sort(function(a,b) {
                        var nameA = (a.chars && a.chars[0] && a.chars[0].name) ? a.chars[0].name : ''
                        var nameB = (b.chars && b.chars[0] && b.chars[0].name) ? b.chars[0].name : ''
                        return nameA.localeCompare(nameB)
                    })
                    break
                case 'image_count_desc':
                    // Sort by image count descending (most first)
                    // Treat null as 0 for sorting
                    workingChats.sort(function(a,b) {
                        var countA = a.imageCount !== null ? a.imageCount : 0
                        var countB = b.imageCount !== null ? b.imageCount : 0
                        return countB - countA
                    })
                    break
                case 'image_count_asc':
                    // Sort by image count ascending (least first)
                    // Treat null as 0 for sorting
                    workingChats.sort(function(a,b) {
                        var countA = a.imageCount !== null ? a.imageCount : 0
                        var countB = b.imageCount !== null ? b.imageCount : 0
                        return countA - countB
                    })
                    break
                case 'date_desc':
                default:
                    workingChats.sort(function(a,b) {
                        return new Date(b.date) - new Date(a.date);
                    });
                    break
            }
            }
            try { window.currentChats = workingChats } catch (_) {}
            renderChatList()

            // Update title count to reflect current filtered list
            updateTitleCount()
        }

        // Function to update the title count based on current filtered list
        function updateTitleCount() {
            var titleEl = document.getElementById('holly-chat-list-title')
            if (!titleEl) return

            var currentCount = workingChats.length
            var baseTitleText

            // Determine title based on active filters
            if (isBookmarkFilterActive) {
                baseTitleText = 'Bookmarks'
            } else if (isRecentChatsFilterActive) {
                baseTitleText = 'Recent Chats'
            } else {
                // No filters active - show "All Chats"
                baseTitleText = 'All Chats'
            }

            titleEl.textContent = baseTitleText + ' (' + currentCount + ')'
            titleEl.title = baseTitleText + ' (' + currentCount + ')'
        }

        // Initial render
        recomputeList()

        // Sorting behavior
        function applySort(value) {
            currentSort = value

            // If sorting by image count, fetch counts for chats that don't have them yet
            if (value === 'image_count_desc' || value === 'image_count_asc') {
                ChatManager.fetchImageCountsForMissingChats(originalChats, function() {
                    recomputeList();
                }, sortSelect);
            } else {
                recomputeList();
            }
        }
        sortSelect.addEventListener('change', function(){ applySort(this.value); });

        // Hook up search
        searchInput.addEventListener('input', function(){
            currentSearch = (this.value || '').trim().toLowerCase()
            recomputeList()
        })

        popup.appendChild(list)

        // Bottom footer with format selector
        const footer = document.createElement('div')
        footer.style.cssText = `display: flex; justify-content: flex-start; align-items: center; gap: 12px; padding-top: 12px; border-top: 1px solid ${colorScheme.border}; margin-top: 8px; align-items: baseline; align-items: center;`
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

    // ============================================================================
    // IMAGE MANAGER MODULE
    // ============================================================================
    var ImageManager = {
        // Close image popup modal
        closeImagePopup: function() {
        // Start closing animation
        if (imagePopup && imagePopup.parentNode)
            {
            imagePopup.style.opacity = '0'
            imagePopup.style.transform = 'translate(-50%, -50%) scale(0.95)'

            // Remove from DOM after animation
            setTimeout(function() {
                if (imagePopup && imagePopup.parentNode) {
                    imagePopup.parentNode.removeChild(imagePopup)
                    imagePopup = null
                }
                // Unlock body scroll when popup closes (only if viewer isn't open)
                if (!imageViewerModal || !imageViewerModal.parentNode) {
                    unlockBodyScroll()
                }
            }, 300)
            }

        // Remove backdrop if it exists - search by z-index and style pattern
        var backdrop = document.querySelector('div[style*="position: fixed"][style*="z-index: 999998"]')
        if (backdrop) {
            backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0)'
            backdrop.style.backdropFilter = 'blur(0px)'
            backdrop.style.webkitBackdropFilter = 'blur(0px)'

            // Remove from DOM after animation
            setTimeout(function() {
                if (backdrop && backdrop.parentNode) {
                    backdrop.remove()
                }
                // Unlock body scroll after backdrop is removed (only if viewer isn't open)
                if (!imageViewerModal || !imageViewerModal.parentNode) {
                    unlockBodyScroll()
                }
            }, 300)
        } else {
            // If no backdrop found, unlock scroll immediately (only if viewer isn't open)
            if (!imageViewerModal || !imageViewerModal.parentNode) {
                unlockBodyScroll()
            }
        }
        },

        // Show full-screen image viewer
        showImageViewer: function(imageData, index) {
            // Remove any previous keydown handler to prevent event stacking
            if (window.hollyImageViewerKeyHandler) {
                document.removeEventListener('keydown', window.hollyImageViewerKeyHandler, true)
                window.hollyImageViewerKeyHandler = null
            }

            // Store the image list and current index
            imageViewerImages = filteredImages
            currentImageViewerIndex = index

            // Close any existing viewer
            ImageManager.closeImageViewer()

            // Lock body scroll when viewer opens
            lockBodyScroll()

            // Create backdrop overlay
            const backdrop = document.createElement('div')
            backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0); z-index: 1000000; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); transition: background-color 0.3s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease; cursor: pointer;'
            backdrop.onclick = ImageManager.closeImageViewer
            document.body.appendChild(backdrop)

            // Create modal container
            imageViewerModal = document.createElement('div')
            imageViewerModal.className = 'image-viewer-modal'
            imageViewerModal.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.9); z-index: 1000001; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease; max-width: 95vw; max-height: 95vh;`
            document.body.appendChild(imageViewerModal)

            // Create content container for proper positioning
            const contentContainer = document.createElement('div')
            contentContainer.className = 'image-viewer-content'
            contentContainer.style.cssText = 'position: relative; max-width: 95vw; max-height: 95vh; display: flex; align-items: center; justify-content: center;'
            imageViewerModal.appendChild(contentContainer)

            // Comparison mode state (shared across navigation functions)
            let isComparisonMode = false
            const batchImages = ImageManager.findBatchImages(index, imageViewerImages)
            const isBatch = batchImages.length >= 2

            // Store references for renderComparisonView to access
            window.hollyShowImageAtIndex = null
            window.hollyIsComparisonModeRef = { current: isComparisonMode }
            window.hollyComparisonToggleBtnRef = { current: null }
            window.hollyComparisonToggleBtnVarRef = { current: null } // Mutable reference to comparisonToggleBtn variable
            // Store setter to update isComparisonMode from outside
            window.hollySetComparisonMode = (value) => {
                isComparisonMode = value
                window.hollyIsComparisonModeRef.current = value
            }

            // Create comparison mode toggle (only show if batch exists)
            // Use object wrapper so it can be updated when navigating to batch
            const comparisonToggleBtnRef = { current: null }
            window.hollyComparisonToggleBtnVarRef.current = comparisonToggleBtnRef

            // Navigation function
            const showImageAtIndex = (idx) => {
                if (idx < 0 || idx >= imageViewerImages.length) return
                currentImageViewerIndex = idx

                // Check if new image is part of a batch
                const newBatchImages = ImageManager.findBatchImages(idx, imageViewerImages)
                const isNewBatch = newBatchImages.length >= 2

                // Update batch images if in comparison mode when navigating
                if (isComparisonMode) {
                    // Show current image in grid view (even if it's a single image)
                    // For single images, show just that one image in the grid
                    const imagesToShow = isNewBatch ? newBatchImages : [imageViewerImages[idx]]
                    ImageManager.renderComparisonView(true, imagesToShow)
                    window.hollyIsComparisonModeRef.current = isComparisonMode
                }

                // Check if this image is on a different page in the image popup
                const imagePage = Math.floor(idx / pageSize) + 1
                if (imagePage !== currentPage) {
                    currentPage = imagePage
                    ImageManager.displayCurrentPage()
                    ImageManager.updatePaginationControls()
                }

                var imageZoomContainer = imageViewerModal.querySelector('.image-zoom-container')
                var img = imageZoomContainer ? imageZoomContainer.querySelector('img') : imageViewerModal.querySelector('img')
                var metadata = imageViewerModal.querySelector('.image-metadata')
                var messageDiv = metadata.querySelector('.metadata-message')
                var timestampDiv = metadata.querySelector('.metadata-timestamp')
                var modelDiv = metadata.querySelector('.metadata-model')
                var leftArrow = document.querySelector('.image-viewer-arrow-left')
                var rightArrow = document.querySelector('.image-viewer-arrow-right')

                // Fade out
                if (img) img.style.opacity = '0'
                metadata.style.opacity = '0'

                // Reset zoom and pan when changing images
                if (imageZoomContainer) {
                    currentZoom = 1
                    currentPanX = 0
                    currentPanY = 0
                    applyZoomAndPan()
                    var zoomSlider = document.getElementById('holly-zoom-slider-container') ? document.getElementById('holly-zoom-slider-container').querySelector('input[type="range"]') : null
                    if (zoomSlider) {
                        zoomSlider.value = 0
                        var zoomValueLabel = document.querySelector('.zoom-value-label')
                        if (zoomValueLabel) zoomValueLabel.textContent = '1.0x'
                        zoomSlider.title = 'Zoom: 1.0x'
                    }
                }

                setTimeout(function() {
                    if (img) img.src = imageViewerImages[idx].url
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
                        detailsHTML += `<div style="margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <strong style="color: ${colorScheme.accent};">Prompt:</strong>
                                <button class="copy-prompt-btn" data-prompt="${t2i.prompt.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textSecondary}; border: 1px solid ${colorScheme.border}; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; transition: all 0.2s;">
                                    Copy
                                </button>
                </div>
                            <div style="color: ${colorScheme.textPrimary}; font-size: 11px; line-height: 1.5; margin-top: 4px; word-wrap: break-word;">${t2i.prompt}</div>
                        </div>`
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

                    // Add copy button functionality
                    const copyBtn = detailsSection.querySelector('.copy-prompt-btn')
                    if (copyBtn) {
                        copyBtn.addEventListener('click', async function(e) {
                            e.stopPropagation()
                            let prompt = this.getAttribute('data-prompt')
                            if (prompt) {
                                // Decode HTML entities
                                const textarea = document.createElement('textarea')
                                textarea.innerHTML = prompt
                                prompt = textarea.value
                                try {
                                    await navigator.clipboard.writeText(prompt)
                                    const originalText = this.textContent
                                    this.textContent = 'Copied!'
                                    this.style.color = colorScheme.accent
                                    this.style.borderColor = colorScheme.accent
                                    setTimeout(() => {
                                        this.textContent = originalText
                                        this.style.color = colorScheme.textSecondary
                                        this.style.borderColor = colorScheme.border
                                    }, 2000)
                                } catch (err) {
                                    console.error('Failed to copy prompt:', err)
                                    // Fallback for older browsers
                                    const textarea = document.createElement('textarea')
                                    textarea.value = prompt
                                    textarea.style.position = 'fixed'
                                    textarea.style.opacity = '0'
                                    document.body.appendChild(textarea)
                                    textarea.select()
                                    try {
                                        document.execCommand('copy')
                                        const originalText = this.textContent
                                        this.textContent = 'Copied!'
                                        this.style.color = colorScheme.accent
                                        setTimeout(() => {
                                            this.textContent = originalText
                                            this.style.color = colorScheme.textSecondary
                                        }, 2000)
                                    } catch (fallbackErr) {
                                        console.error('Fallback copy failed:', fallbackErr)
                                    }
                                    document.body.removeChild(textarea)
                                }
                            }
                        })
                    }

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
                    leftArrow.style.opacity = idx === 0 ? '0.3' : '0.75'
                    rightArrow.style.opacity = idx === imageViewerImages.length - 1 ? '0.3' : '0.75'
                }, 150)
            }

            // Throttle navigation to prevent key repeat from skipping
            let navLocked = false
            const navigate = (delta) => {
                if (navLocked) return

                let targetIndex
                if (isComparisonMode) {
                    // Navigate by batches when in comparison mode
                    const currentBatch = ImageManager.findBatchImages(currentImageViewerIndex, imageViewerImages)
                    const currentBatchStart = imageViewerImages.findIndex(img => img.url === currentBatch[0].url)
                    const currentBatchEnd = imageViewerImages.findIndex(img => img.url === currentBatch[currentBatch.length - 1].url)

                    if (delta > 0) {
                        // Going forward - jump to first image of next batch
                        targetIndex = currentBatchEnd + 1
                        // Find the next batch starting from targetIndex
                        if (targetIndex < imageViewerImages.length) {
                            const nextBatch = ImageManager.findBatchImages(targetIndex, imageViewerImages)
                            if (nextBatch.length >= 2) {
                                // Next batch found, use its first image
                                targetIndex = imageViewerImages.findIndex(img => img.url === nextBatch[0].url)
                            }
                            // If no batch found, just use targetIndex (single image)
                        }
                    } else {
                        // Going backward - jump to first image of previous batch
                        targetIndex = currentBatchStart - 1
                        if (targetIndex >= 0) {
                            // Find what batch the previous image belongs to
                            const prevBatch = ImageManager.findBatchImages(targetIndex, imageViewerImages)
                            if (prevBatch.length >= 2) {
                                // Previous image is part of a batch, use first image of that batch
                                targetIndex = imageViewerImages.findIndex(img => img.url === prevBatch[0].url)
                            }
                            // If prevBatch is single image (length 1), just use targetIndex
                        }
                    }
                } else {
                    // Normal single-image navigation
                    targetIndex = currentImageViewerIndex + delta
                }

                if (targetIndex < 0 || targetIndex >= imageViewerImages.length) return
                navLocked = true
                showImageAtIndex(targetIndex)
                setTimeout(() => { navLocked = false }, 180)
            }

            // Create close button (square with X)
            const closeBtn = document.createElement('button')
            closeBtn.innerHTML = '✕'
            closeBtn.style.cssText = `position: fixed; top: 20px; right: 20px; width: 64px; height: 64px; border-radius: 12px; background: ${colorScheme.cardBackground}; border: 2px solid ${colorScheme.border}; color: ${colorScheme.textPrimary}; font-size: 24px; cursor: pointer; z-index: 1000002; display: flex; align-items: center; justify-content: center; transition: all 0.2s; font-weight: bold;`
            closeBtn.addEventListener('click', ImageManager.closeImageViewer)
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

            // Create comparison mode toggle (always show)
            const comparisonToggleBtn = document.createElement('button')
            comparisonToggleBtn.setAttribute('type', 'button')
            comparisonToggleBtn.setAttribute('data-prevent-progress', 'true')

            // Create the icon container div
            const iconContainer = document.createElement('div')
        iconContainer.style.cssText = `display: flex; height: 64px; width: 64px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 12px; border: 2px solid ${colorScheme.border}; background: ${colorScheme.cardBackground}; color: ${colorScheme.textPrimary};`

        // Grid view SVG icon
        const gridIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        gridIcon.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        gridIcon.setAttribute('fill', 'none')
        gridIcon.setAttribute('viewBox', '0 0 24 24')
        gridIcon.setAttribute('stroke-width', '1.5')
        gridIcon.setAttribute('stroke', 'currentColor')
        gridIcon.setAttribute('aria-hidden', 'true')
        gridIcon.setAttribute('data-slot', 'icon')
        gridIcon.style.cssText = 'height: 24px; width: 24px;'

        const gridPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        gridPath.setAttribute('stroke-linecap', 'round')
        gridPath.setAttribute('stroke-linejoin', 'round')
        gridPath.setAttribute('d', 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z')

        gridIcon.appendChild(gridPath)
        iconContainer.appendChild(gridIcon)
        comparisonToggleBtn.appendChild(iconContainer)

        comparisonToggleBtn.style.cssText = `position: fixed; top: 20px; left: 20px; cursor: pointer; z-index: 1000002; padding: 0; border: none; background: transparent; transition: all 0.2s;`

        comparisonToggleBtn.addEventListener('click', function(e) {
            e.stopPropagation()
            isComparisonMode = !isComparisonMode
            window.hollyIsComparisonModeRef.current = isComparisonMode
            // Get current batch images for this image (works for both single and batch)
            const currentIdx = currentImageViewerIndex
            const currentBatch = ImageManager.findBatchImages(currentIdx, imageViewerImages)
            // If single image, show it in grid view too
            const imagesToShow = currentBatch.length >= 2 ? currentBatch : [imageViewerImages[currentIdx]]
            ImageManager.renderComparisonView(isComparisonMode, imagesToShow)

            // Update icon based on mode (grid icon for grid view, single square icon for single view)
            if (isComparisonMode) {
                // Single view icon (single square representing one image)
                gridPath.setAttribute('d', 'M3.75 4.5A2.25 2.25 0 0 0 1.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25h16.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H3.75Z')
            } else {
                // Grid view icon (original 2x2 grid)
                gridPath.setAttribute('d', 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z')
            }
        })

        comparisonToggleBtn.addEventListener('mouseenter', function() {
            iconContainer.style.backgroundColor = colorScheme.hoverBackground
            iconContainer.style.color = colorScheme.hoverText
            iconContainer.style.borderColor = colorScheme.hoverText
        })
        comparisonToggleBtn.addEventListener('mouseleave', function() {
            iconContainer.style.backgroundColor = colorScheme.cardBackground
            iconContainer.style.color = colorScheme.textPrimary
            iconContainer.style.borderColor = colorScheme.border
        })

        // Store reference to toggle button
        comparisonToggleBtnRef.current = comparisonToggleBtn
        window.hollyComparisonToggleBtnRef.current = comparisonToggleBtn
        window.hollyComparisonToggleBtnVarRef.current = comparisonToggleBtnRef

        document.body.appendChild(comparisonToggleBtn)

        // Store showImageAtIndex reference after it's fully defined
        window.hollyShowImageAtIndex = showImageAtIndex

        // Create zoom slider control (hidden in grid view)
        var zoomSliderContainer = document.createElement('div')
        zoomSliderContainer.className = 'image-zoom-slider-container'
        zoomSliderContainer.id = 'holly-zoom-slider-container'
        zoomSliderContainer.style.cssText = 'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; z-index: 1000002; background: ' + colorScheme.cardBackground + '; padding: 12px 20px; border-radius: 12px; border: 1px solid ' + colorScheme.border + ';'

        var zoomLabel = document.createElement('span')
        zoomLabel.textContent = 'Zoom'
        zoomLabel.style.cssText = 'color: ' + colorScheme.textPrimary + '; font-size: 14px; font-weight: 500; min-width: 40px;'

        var zoomSlider = document.createElement('input')
        zoomSlider.type = 'range'
        zoomSlider.min = '0'
        zoomSlider.max = '100'
        zoomSlider.value = '0' // 0% = 1.0x zoom (minimum)
        zoomSlider.style.cssText = 'width: 200px; height: 6px; cursor: pointer;'
        zoomSlider.title = 'Zoom: 1.0x'

        var zoomValueLabel = document.createElement('span')
        zoomValueLabel.className = 'zoom-value-label'
        zoomValueLabel.textContent = '1.0x'
        zoomValueLabel.style.cssText = 'color: ' + colorScheme.textSecondary + '; font-size: 12px; min-width: 40px; text-align: right;'

        // Create reset button
        var resetZoomBtn = document.createElement('button')
        resetZoomBtn.innerHTML = '↺'
        resetZoomBtn.style.cssText = 'background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 6px; width: 32px; height: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; transition: all 0.2s; padding: 0;'
        resetZoomBtn.title = 'Reset zoom to 1.0x'
        resetZoomBtn.addEventListener('click', function(e) {
            e.stopPropagation()
            resetZoomAndPan()
            var zoomValueLabel = document.querySelector('.zoom-value-label')
            if (zoomValueLabel) zoomValueLabel.textContent = '1.0x'
            if (zoomSlider) {
                zoomSlider.title = 'Zoom: 1.0x'
            }
        })
        resetZoomBtn.addEventListener('mouseenter', function() {
            this.style.backgroundColor = colorScheme.hoverBackground
            this.style.color = colorScheme.hoverText
            this.style.borderColor = colorScheme.hoverText
        })
        resetZoomBtn.addEventListener('mouseleave', function() {
            this.style.backgroundColor = colorScheme.cardBackground
            this.style.color = colorScheme.textPrimary
            this.style.borderColor = colorScheme.border
        })

        zoomSlider.addEventListener('input', function() {
            var sliderValue = parseFloat(this.value)
            // Map 0-100 to 1x - 5x zoom
            currentZoom = 1 + (sliderValue / 100) * (5 - 1)
            zoomValueLabel.textContent = currentZoom.toFixed(1) + 'x'
            this.title = 'Zoom: ' + currentZoom.toFixed(1) + 'x'

            // Reset pan when zoom changes to 1x
            if (currentZoom <= 1) {
                currentPanX = 0
                currentPanY = 0
            }

            applyZoomAndPan()
        })

        zoomSliderContainer.appendChild(zoomLabel)
        zoomSliderContainer.appendChild(zoomSlider)
        zoomSliderContainer.appendChild(zoomValueLabel)
        zoomSliderContainer.appendChild(resetZoomBtn)
        document.body.appendChild(zoomSliderContainer)

        // Store zoom slider reference for comparison view
        window.hollyZoomSliderContainer = zoomSliderContainer

        // Create metadata toggle container
        var metadataToggleContainer = document.createElement('div')
        metadataToggleContainer.id = 'holly-metadata-toggle-container'
        metadataToggleContainer.style.cssText = `position: fixed; bottom: 20px; left: 20px; display: flex; align-items: center; gap: 12px; z-index: 1000002;`

        // Create toggle switch
        const toggleSwitch = document.createElement('div')
        toggleSwitch.className = 'holly-metadata-toggle-switch'
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
        leftArrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 24px; height: 24px; transform: rotate(-270deg);"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"></path></svg>'
        leftArrow.className = 'image-viewer-arrow-left'
        leftArrow.style.cssText = `position: fixed; top: 50%; left: 20px; transform: translateY(-50%); width: 64px; height: 64px; border-radius: 12px; background: ${colorScheme.cardBackground}; border: 2px solid ${colorScheme.border}; color: ${colorScheme.textPrimary}; cursor: pointer; z-index: 1000002; display: flex; align-items: center; justify-content: center; transition: all 0.2s; opacity: ${index === 0 ? '0.3' : '0.75'};`
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
        rightArrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 24px; height: 24px; transform: rotate(270deg);"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"></path></svg>'
        rightArrow.className = 'image-viewer-arrow-right'
        rightArrow.style.cssText = `position: fixed; top: 50%; right: 20px; transform: translateY(-50%); width: 64px; height: 64px; border-radius: 12px; background: ${colorScheme.cardBackground}; border: 2px solid ${colorScheme.border}; color: ${colorScheme.textPrimary}; cursor: pointer; z-index: 1000002; display: flex; align-items: center; justify-content: center; transition: all 0.2s; opacity: ${index === imageViewerImages.length - 1 ? '0.3' : '0.75'};`
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

        // Create zoom/pan container for image
        var imageZoomContainer = document.createElement('div')
        imageZoomContainer.className = 'image-zoom-container'
        imageZoomContainer.style.cssText = 'position: relative; width: 100%; height: 100%; overflow: hidden; cursor: grab; touch-action: none;'

        // Create image wrapper for transform
        var imageWrapper = document.createElement('div')
        imageWrapper.className = 'image-zoom-wrapper'
        imageWrapper.style.cssText = 'position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; transform-origin: center center; transition: transform 0.1s ease-out;'

        // Create image
        var img = document.createElement('img')
        img.src = imageData.url
        img.style.cssText = 'max-width: 95vw; max-height: 95vh; object-fit: contain; border-radius: 8px; transition: opacity 0.15s; user-select: none; pointer-events: none;'
        img.draggable = false

        // Zoom state
        var currentZoom = 1
        var currentPanX = 0
        var currentPanY = 0
        var isDragging = false
        var dragStartX = 0
        var dragStartY = 0
        var dragStartPanX = 0
        var dragStartPanY = 0
        var initialDistance = 0

        // Function to apply zoom and pan
        function applyZoomAndPan() {
            var transform = 'translate(' + currentPanX + 'px, ' + currentPanY + 'px) scale(' + currentZoom + ')'
            imageWrapper.style.transform = transform
        }

        // Function to reset zoom and pan and recenter image
        function resetZoomAndPan() {
            currentZoom = 1
            // Reset pan to center (0, 0) - image wrapper is centered with flexbox
            currentPanX = 0
            currentPanY = 0

            // Force a recalculation to ensure centering is applied
            applyZoomAndPan()

            // Use requestAnimationFrame to ensure transform is applied smoothly
            requestAnimationFrame(function() {
                applyZoomAndPan()
                // Ensure cursor returns to default
                if (imageZoomContainer) {
                    imageZoomContainer.style.cursor = 'default'
                }
            })

            if (zoomSlider) zoomSlider.value = 0 // 0% = 1.0x zoom (minimum)
            var zoomValueLabel = document.querySelector('.zoom-value-label')
            if (zoomValueLabel) zoomValueLabel.textContent = '1.0x'
            if (zoomSlider) zoomSlider.title = 'Zoom: 1.0x'
        }

        // Mouse drag for panning
        imageZoomContainer.addEventListener('mousedown', function(e) {
            if (currentZoom > 1) {
                isDragging = true
                dragStartX = e.clientX
                dragStartY = e.clientY
                dragStartPanX = currentPanX
                dragStartPanY = currentPanY
                imageZoomContainer.style.cursor = 'grabbing'
                e.preventDefault()
            }
        })

        document.addEventListener('mousemove', function(e) {
            if (isDragging && currentZoom > 1) {
                var deltaX = e.clientX - dragStartX
                var deltaY = e.clientY - dragStartY
                currentPanX = dragStartPanX + deltaX
                currentPanY = dragStartPanY + deltaY
                applyZoomAndPan()
            }
        })

        document.addEventListener('mouseup', function() {
            if (isDragging) {
                isDragging = false
                imageZoomContainer.style.cursor = currentZoom > 1 ? 'grab' : 'default'
            }
        })

        // Touch handlers for pinch-to-zoom and pan
        var touchStartDistance = 0
        var touchStartZoom = 1
        var touchStartPanX = 0
        var touchStartPanY = 0
        var touchCenterX = 0
        var touchCenterY = 0
        var lastTouchCount = 0

        imageZoomContainer.addEventListener('touchstart', function(e) {
            if (e.touches.length === 2) {
                // Pinch gesture - calculate initial distance
                var touch1 = e.touches[0]
                var touch2 = e.touches[1]
                var dx = touch2.clientX - touch1.clientX
                var dy = touch2.clientY - touch1.clientY
                touchStartDistance = Math.sqrt(dx * dx + dy * dy)
                touchStartZoom = currentZoom
                touchStartPanX = currentPanX
                touchStartPanY = currentPanY

                // Calculate center point
                touchCenterX = (touch1.clientX + touch2.clientX) / 2
                touchCenterY = (touch1.clientY + touch2.clientY) / 2

                e.preventDefault()
            } else if (e.touches.length === 1 && currentZoom > 1) {
                // Single touch for panning when zoomed
                var touch = e.touches[0]
                dragStartX = touch.clientX
                dragStartY = touch.clientY
                dragStartPanX = currentPanX
                dragStartPanY = currentPanY
                isDragging = true
            }
            lastTouchCount = e.touches.length
        }, { passive: false })

        imageZoomContainer.addEventListener('touchmove', function(e) {
            if (e.touches.length === 2) {
                // Pinch gesture - calculate current distance
                var touch1 = e.touches[0]
                var touch2 = e.touches[1]
                var dx = touch2.clientX - touch1.clientX
                var dy = touch2.clientY - touch1.clientY
                var currentDistance = Math.sqrt(dx * dx + dy * dy)

                if (touchStartDistance > 0) {
                    // Calculate zoom factor (scale by distance ratio)
                    var zoomFactor = currentDistance / touchStartDistance
                    var newZoom = Math.max(1, Math.min(5, touchStartZoom * zoomFactor))
                    currentZoom = newZoom

                    // Update zoom slider
                    if (zoomSlider) {
                        var sliderValue = ((newZoom - 1) / (5 - 1)) * 100
                        zoomSlider.value = sliderValue
                        var zoomValueLabel = document.querySelector('.zoom-value-label')
                        if (zoomValueLabel) zoomValueLabel.textContent = newZoom.toFixed(1) + 'x'
                        zoomSlider.title = 'Zoom: ' + newZoom.toFixed(1) + 'x'
                    }

                    // Update pan to keep pinch center point under fingers
                    var newCenterX = (touch1.clientX + touch2.clientX) / 2
                    var newCenterY = (touch1.clientY + touch2.clientY) / 2
                    var centerDeltaX = newCenterX - touchCenterX
                    var centerDeltaY = newCenterY - touchCenterY
                    currentPanX = touchStartPanX + centerDeltaX
                    currentPanY = touchStartPanY + centerDeltaY

                    applyZoomAndPan()
                }
                e.preventDefault()
            } else if (e.touches.length === 1 && isDragging && currentZoom > 1) {
                // Single touch panning when zoomed
                var touch = e.touches[0]
                var deltaX = touch.clientX - dragStartX
                var deltaY = touch.clientY - dragStartY
                currentPanX = dragStartPanX + deltaX
                currentPanY = dragStartPanY + deltaY
                applyZoomAndPan()
                e.preventDefault()
            }
        }, { passive: false })

        imageZoomContainer.addEventListener('touchend', function(e) {
            if (lastTouchCount === 2 && e.touches.length < 2) {
                // Pinch ended
                touchStartDistance = 0
            }
            if (e.touches.length === 0) {
                isDragging = false
            }
            lastTouchCount = e.touches.length
        }, { passive: true })

        imageWrapper.appendChild(img)
        imageZoomContainer.appendChild(imageWrapper)

        // Double-click to reset zoom (must be after imageZoomContainer is created)
        imageZoomContainer.addEventListener('dblclick', resetZoomAndPan)

        // Scroll wheel zoom
        imageZoomContainer.addEventListener('wheel', function(e) {
            // Don't zoom if in comparison/grid view
            var gridView = imageViewerModal.querySelector('.comparison-grid')
            if (gridView && gridView.style.display !== 'none') {
                return // Allow normal scrolling in grid view
            }

            e.preventDefault()
            e.stopPropagation()

            // Calculate zoom delta (negative deltaY = scroll up = zoom in)
            var zoomDelta = -e.deltaY * 0.001 // Sensitivity factor
            var newZoom = Math.max(1, Math.min(5, currentZoom + zoomDelta))

            // Only update if zoom actually changed
            if (Math.abs(newZoom - currentZoom) < 0.01) {
                return
            }

            currentZoom = newZoom

            // Reset pan when zoom reaches 1x
            if (currentZoom <= 1) {
                currentPanX = 0
                currentPanY = 0
            }

            // Update zoom slider
            if (zoomSlider) {
                var sliderValue = ((currentZoom - 1) / (5 - 1)) * 100
                zoomSlider.value = sliderValue
                zoomSlider.title = 'Zoom: ' + currentZoom.toFixed(1) + 'x'
            }

            // Update zoom value label
            var zoomValueLabel = document.querySelector('.zoom-value-label')
            if (zoomValueLabel) {
                zoomValueLabel.textContent = currentZoom.toFixed(1) + 'x'
            }

            applyZoomAndPan()
        }, { passive: false })

        // Add metadata below image
        var metadata = document.createElement('div')
        metadata.className = 'image-metadata'
        // Check localStorage for user's metadata visibility preference
        var savedMetadataVisible = localStorage.getItem('hollyMetadataVisible') === 'true'
        var initialDisplay = savedMetadataVisible ? 'block' : 'none'
        metadata.style.cssText = 'position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; padding: 12px 20px; border-radius: 8px; border: 1px solid ' + colorScheme.border + '; font-size: 14px; max-width: 80vw; text-align: center; transition: opacity 0.15s; display: ' + initialDisplay + ';'

        var message = document.createElement('div')
        message.className = 'metadata-message'
        message.style.cssText = 'margin-bottom: 8px; font-weight: 500; color: ' + colorScheme.textPrimary + ';'
        message.textContent = imageData.message

        var timestamp = document.createElement('div')
        timestamp.className = 'metadata-timestamp'
        timestamp.style.cssText = 'font-size: 12px; color: ' + colorScheme.textSecondary + ';'
        timestamp.textContent = new Date(imageData.timestamp).toLocaleString()

        var model = document.createElement('div')
        model.className = 'metadata-model'
        model.style.cssText = 'font-size: 12px; color: ' + colorScheme.accent + '; margin-top: 4px;'
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
                detailsHTML += `<div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <strong style="color: ${colorScheme.accent};">Prompt:</strong>
                        <button class="copy-prompt-btn" data-prompt="${t2i.prompt.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" style="background: ${colorScheme.cardBackground}; color: ${colorScheme.textSecondary}; border: 1px solid ${colorScheme.border}; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; transition: all 0.2s;">
                            Copy
                        </button>
                    </div>
                    <div style="color: ${colorScheme.textPrimary}; font-size: 11px; line-height: 1.5; margin-top: 4px; word-wrap: break-word;">${t2i.prompt}</div>
                </div>`
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

            // Add copy button functionality
            const copyBtn = detailsSection.querySelector('.copy-prompt-btn')
            if (copyBtn) {
                copyBtn.addEventListener('click', async function(e) {
                    e.stopPropagation()
                    let prompt = this.getAttribute('data-prompt')
                    if (prompt) {
                        // Decode HTML entities
                        const textarea = document.createElement('textarea')
                        textarea.innerHTML = prompt
                        prompt = textarea.value
                        try {
                            await navigator.clipboard.writeText(prompt)
                            const originalText = this.textContent
                            this.textContent = 'Copied!'
                            this.style.color = colorScheme.accent
                            this.style.borderColor = colorScheme.accent
                            setTimeout(() => {
                                this.textContent = originalText
                                this.style.color = colorScheme.textSecondary
                                this.style.borderColor = colorScheme.border
                            }, 2000)
                        } catch (err) {
                            console.error('Failed to copy prompt:', err)
                            // Fallback for older browsers
                            const textarea = document.createElement('textarea')
                            textarea.value = prompt
                            textarea.style.position = 'fixed'
                            textarea.style.opacity = '0'
                            document.body.appendChild(textarea)
                            textarea.select()
                            try {
                                document.execCommand('copy')
                                const originalText = this.textContent
                                this.textContent = 'Copied!'
                                this.style.color = colorScheme.accent
                                setTimeout(() => {
                                    this.textContent = originalText
                                    this.style.color = colorScheme.textSecondary
                                }, 2000)
                            } catch (fallbackErr) {
                                console.error('Fallback copy failed:', fallbackErr)
                            }
                            document.body.removeChild(textarea)
                        }
                    }
                })
            }

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
        var keyHandler = function(e) {
            if (e.key === 'Escape') {
                // Always close viewer if it's open, and stop propagation so popup handler doesn't fire
                if (imageViewerModal && imageViewerModal.parentNode) {
                    e.preventDefault()
                    e.stopPropagation()
                    ImageManager.closeImageViewer()
                    document.removeEventListener('keydown', keyHandler, true)
                    window.hollyImageViewerKeyHandler = null
                }
            } else {
                // Allow arrow key navigation (will update batch if in comparison mode)
                if (e.key === 'ArrowLeft') {
                    e.preventDefault()
                    navigate(-1)
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    navigate(1)
                }
            }
        }
        // Use capture phase so this handler fires before the popup's handler
        document.addEventListener('keydown', keyHandler, true)
        window.hollyImageViewerKeyHandler = keyHandler

        // Add swipe gesture support for mobile
        var touchStartX = null;
        var touchStartY = null;
        var touchEndX = null;
        var touchEndY = null;
        var minSwipeDistance = 50; // Minimum distance in pixels to register a swipe
        var maxVerticalDistance = 100; // Maximum vertical movement allowed for horizontal swipe
        var touchTargetIsMetadata = false; // Track if touch started on metadata

        var handleTouchStart = function(e) {
            var touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;

            // Check if touch target is within metadata section (allow scrolling)
            var target = e.target;
            var metadata = contentContainer.querySelector('.image-metadata');
            var detailsSection = contentContainer.querySelector('.metadata-details');
            touchTargetIsMetadata = false;

            // Check if target is metadata, details section, or a child of either
            var node = target;
            while (node && node !== contentContainer) {
                if (node === metadata ||
                    node.classList.contains('image-metadata') ||
                    node === detailsSection ||
                    node.classList.contains('metadata-details')) {
                    touchTargetIsMetadata = true;
                    break;
                }
                node = node.parentNode;
            }
        };

        var handleTouchMove = function(e) {
            // Allow scrolling in metadata section - never prevent default there
            if (touchTargetIsMetadata) {
                return; // Allow default scrolling behavior
            }

            // For touches on image, check if this is a vertical scroll attempt
            // If vertical movement is significant, don't prevent default (allows page scrolling)
            if (touchStartX !== null && touchStartY !== null) {
                var touch = e.touches[0];
                var deltaY = Math.abs(touch.clientY - touchStartY);
                var deltaX = Math.abs(touch.clientX - touchStartX);

                // If vertical movement is greater than horizontal, allow scrolling
                if (deltaY > deltaX && deltaY > 10) {
                    return; // Allow scrolling
                }
            }

            // Only prevent default for horizontal swipes on the image
            if (imageViewerModal && imageViewerModal.parentNode) {
                e.preventDefault();
            }
        };

        var handleTouchEnd = function(e) {
            if (!touchStartX || !touchStartY) {
                touchTargetIsMetadata = false;
                return;
            }

            // Don't trigger swipe navigation if touch was on metadata
            if (touchTargetIsMetadata) {
                touchTargetIsMetadata = false;
                return;
            }

            var touch = e.changedTouches[0];
            touchEndX = touch.clientX;
            touchEndY = touch.clientY;

            var deltaX = touchEndX - touchStartX;
            var deltaY = touchEndY - touchStartY;
            var absDeltaX = Math.abs(deltaX);
            var absDeltaY = Math.abs(deltaY);

            // Reset touch positions
            touchStartX = null;
            touchStartY = null;
            touchEndX = null;
            touchEndY = null;
            touchTargetIsMetadata = false;

            // Only register horizontal swipe if:
            // 1. Horizontal movement is greater than minimum distance
            // 2. Horizontal movement is greater than vertical movement (mostly horizontal)
            // 3. Vertical movement is not too large (prevents accidental swipes during scrolling)
            // 4. Image is zoomed out to 1x (swipe navigation only works at 1x zoom)
            if (absDeltaX > minSwipeDistance && absDeltaX > absDeltaY && absDeltaY < maxVerticalDistance && currentZoom === 1) {
                if (deltaX > 0) {
                    // Swipe right - go to previous image
                    navigate(-1);
                } else {
                    // Swipe left - go to next image
                    navigate(1);
                }
            }
        };

        // Add touch event listeners to content container (works for both single and comparison view)
        contentContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
        contentContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
        contentContainer.addEventListener('touchend', handleTouchEnd, { passive: true });

        // Store handlers for cleanup
        window.hollyImageViewerTouchHandlers = {
            start: handleTouchStart,
            move: handleTouchMove,
            end: handleTouchEnd,
            container: contentContainer
        }

        contentContainer.appendChild(imageZoomContainer)
        contentContainer.appendChild(metadata)
        document.body.appendChild(closeBtn)
        document.body.appendChild(metadataToggleContainer)
        document.body.appendChild(downloadBtn)
        document.body.appendChild(leftArrow)
        document.body.appendChild(rightArrow)

        // Trigger animation
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.75)'
                backdrop.style.backdropFilter = 'blur(8px)'
                backdrop.style.webkitBackdropFilter = 'blur(8px)'
                imageViewerModal.style.opacity = '1'
                imageViewerModal.style.transform = 'translate(-50%, -50%) scale(1)'
            })
        })
        },

        // Render comparison view (2x2 grid)
        renderComparisonView: function(enabled, batchImages) {
            var contentContainer = imageViewerModal.querySelector('div')
            if (!contentContainer) return

            // Fade out existing comparison grid if present
            var existingGrid = contentContainer.querySelector('.comparison-grid')
            if (existingGrid) {
                // Get all images in the existing grid and fade them out
                var existingImages = existingGrid.querySelectorAll('img')
                for (var i = 0; i < existingImages.length; i++) {
                    existingImages[i].style.transition = 'opacity 0.15s'
                    existingImages[i].style.opacity = '0'
                }

                // Remove grid after fade out completes
                setTimeout(function() {
                    if (existingGrid && existingGrid.parentNode) {
                        existingGrid.parentNode.removeChild(existingGrid)
                    }
                    // Continue with creating new grid after old one is removed
                    ImageManager._createComparisonGrid(enabled, batchImages, contentContainer)
                }, 150)
            } else {
                // No existing grid, create new one immediately
                ImageManager._createComparisonGrid(enabled, batchImages, contentContainer)
            }
        },

        // Helper function to create the comparison grid (separated for fade transitions)
        _createComparisonGrid: function(enabled, batchImages, contentContainer) {

            // Hide/show single image view
            var imageZoomContainer = contentContainer.querySelector('.image-zoom-container')
            var singleImg = imageZoomContainer ? imageZoomContainer.querySelector('img') : contentContainer.querySelector('img')
            var metadata = contentContainer.querySelector('.image-metadata')

            // Find metadata toggle container and download button using stored references
            var metadataToggle = document.getElementById('holly-metadata-toggle-container')

            // Find download button more reliably
            var downloadButton = null
            var allButtons = document.querySelectorAll('button')
            for (var btnIdx = 0; btnIdx < allButtons.length; btnIdx++) {
                var btn = allButtons[btnIdx]
                if (btn.textContent === 'Download' && btn.style.position === 'fixed' && btn.style.bottom === '20px') {
                    downloadButton = btn
                break
            }
        }

            var imageZoomContainer = contentContainer.querySelector('.image-zoom-container')
            var singleImg = imageZoomContainer ? imageZoomContainer.querySelector('img') : contentContainer.querySelector('img')
            var metadata = contentContainer.querySelector('.image-metadata')

            // Find metadata toggle container and download button using stored references
            var metadataToggle = document.getElementById('holly-metadata-toggle-container')

            // Find download button more reliably
            var downloadButton = null
            var allButtons = document.querySelectorAll('button')
            for (var btnIdx = 0; btnIdx < allButtons.length; btnIdx++) {
                var btn = allButtons[btnIdx]
                if (btn.textContent === 'Download' && btn.style.position === 'fixed' && btn.style.bottom === '20px') {
                    downloadButton = btn
                    break
                }
            }

            if (enabled) {
                // Hide single image, zoom container, metadata, metadata toggle, download button, and zoom slider
                if (imageZoomContainer) imageZoomContainer.style.display = 'none'
                if (singleImg) singleImg.style.display = 'none'
                if (metadata) metadata.style.display = 'none'
                if (metadataToggle) metadataToggle.style.display = 'none'
                if (downloadButton) downloadButton.style.display = 'none'
                var zoomSliderContainer = document.getElementById('holly-zoom-slider-container')
                if (zoomSliderContainer) zoomSliderContainer.style.display = 'none'

                // Create grid container
                var grid = document.createElement('div')
                grid.className = 'comparison-grid'
                // Always use 2 columns - single images will be centered
                var numImages = batchImages.length
                var gridCols = 'repeat(2, 1fr)'
                grid.style.cssText = 'display: grid; grid-template-columns: ' + gridCols + '; grid-template-rows: 1fr; gap: 16px; width: 95vw; max-width: 1400px; height: 90vh; max-height: 90vh; padding: 20px; box-sizing: border-box; align-items: stretch; justify-items: stretch;'

                // Add mobile-specific class for responsive styling (only for 2 images)
                if (numImages === 2) {
                    grid.classList.add('comparison-grid-2')
                }

                // Add class for single image grids
                if (numImages === 1) {
                    grid.classList.add('comparison-grid-single')
                }

                // Add desktop and mobile responsive styles if not already added
                if (!document.getElementById('comparison-grid-mobile-style')) {
                    var mobileStyle = document.createElement('style')
                    mobileStyle.id = 'comparison-grid-mobile-style'
                    mobileStyle.textContent = `
                    /* Desktop styles for grid items */
                    @media (min-width: 769px) {
                        .comparison-grid > div {
                            width: 100% !important;
                            height: 100% !important;
                            min-height: 0 !important;
                        }
                        /* Center single image and make it same size as one grid cell */
                        .comparison-grid-single > div {
                            grid-column: 1 / -1 !important;
                            justify-self: center !important;
                            width: calc((100% - 16px) / 2) !important;
                            max-width: calc((100% - 16px) / 2) !important;
                        }
                    }
                    @media (max-width: 768px) {
                        /* Single image in grid view - full width, half height, centered */
                        .comparison-grid-single {
                            width: 100vw !important;
                            height: 100vh !important;
                            max-width: 100vw !important;
                            max-height: 100vh !important;
                            padding: 12px !important;
                            box-sizing: border-box !important;
                            display: flex !important;
                            align-items: center !important;
                            justify-content: center !important;
                        }
                        .comparison-grid-single > div {
                            grid-column: 1 / -1 !important;
                            width: calc(100vw - 24px) !important;
                            max-width: calc(100vw - 24px) !important;
                            height: 50vh !important;
                            max-height: 50vh !important;
                            padding: 0 !important;
                        }
                        .comparison-grid-single img {
                            width: 100% !important;
                            height: 100% !important;
                            object-fit: cover !important;
                        }
                        /* Two images in grid view */
                        .comparison-grid-2 {
                            grid-template-columns: 1fr !important;
                            grid-template-rows: 1fr 1fr !important;
                            width: 100vw !important;
                            height: 100vh !important;
                            max-width: 100vw !important;
                            max-height: 100vh !important;
                            padding: 12px !important;
                            gap: 12px !important;
                            position: relative !important;
                            top: 0 !important;
                            left: 0 !important;
                            z-index: 1000001 !important;
                            box-sizing: border-box !important;
                        }
                        .comparison-grid-2 > div {
                            width: 100% !important;
                            height: 100% !important;
                            max-height: calc(50vh - 18px) !important;
                            padding: 0 !important;
                        }
                        .comparison-grid-2 img {
                            width: 100% !important;
                            height: 100% !important;
                            object-fit: cover !important;
                        }
                    }
                `
                    document.head.appendChild(mobileStyle)
                }

                // Add each batch image to grid
                var newImages = []
                for (var idx = 0; idx < batchImages.length; idx++) {
                    var imgData = batchImages[idx]

                    // Find the actual index of this image in imageViewerImages
                    var actualIndex = -1
                    for (var searchIdx = 0; searchIdx < imageViewerImages.length; searchIdx++) {
                        // Match by URL and also check if we have additional matching criteria (uuid, timestamp)
                        var matches = imageViewerImages[searchIdx].url === imgData.url
                        if (imgData.uuid && imageViewerImages[searchIdx].uuid) {
                            matches = matches && imageViewerImages[searchIdx].uuid === imgData.uuid
                        }
                        if (matches) {
                            actualIndex = searchIdx
                            break
                        }
                    }

                    var imgContainer = document.createElement('div')
                    imgContainer.style.cssText = 'position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; overflow: hidden;'

                    // Store the actual index as a data attribute for reliable lookup
                    if (actualIndex !== -1) {
                        imgContainer.setAttribute('data-image-index', actualIndex)
                    }

                    var img = document.createElement('img')
                    img.src = imgData.url
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity 0.15s;'
                    newImages.push(img)

                    // Add hover effect
                    imgContainer.addEventListener('mouseenter', function() {
                        this.style.transform = 'scale(1.05)'
                        this.style.boxShadow = '0 4px 12px ' + colorScheme.glowColor
                    })
                    imgContainer.addEventListener('mouseleave', function() {
                        this.style.transform = 'scale(1)'
                        this.style.boxShadow = 'none'
                    })

                    // Click handler to switch to single view of this image
                    imgContainer.addEventListener('click', function() {
                        // Get the stored index from the data attribute
                        var targetIndex = parseInt(this.getAttribute('data-image-index'), 10)
                        if (targetIndex !== -1 && !isNaN(targetIndex) && window.hollyShowImageAtIndex && window.hollySetComparisonMode) {
                            // Exit comparison mode first
                            window.hollySetComparisonMode(false)

                            // Explicitly exit grid view
                            ImageManager.renderComparisonView(false, [])

                            // Navigate to this image (this will update the view)
                            window.hollyShowImageAtIndex(targetIndex)

                            // Update toggle button icon if it exists
                            if (window.hollyComparisonToggleBtnRef && window.hollyComparisonToggleBtnRef.current) {
                                var toggleBtn = window.hollyComparisonToggleBtnRef.current
                                var gridPath = toggleBtn.querySelector('path')
                                if (gridPath) {
                                    gridPath.setAttribute('d', 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z')
                                }
                            }
                        }
                    })

                    imgContainer.appendChild(img)

                    grid.appendChild(imgContainer)
                }

                // Append grid to container (initially with opacity 0 images)
                contentContainer.appendChild(grid)

                // Fade in new images after a brief delay
                setTimeout(function() {
                    for (var i = 0; i < newImages.length; i++) {
                        newImages[i].style.opacity = '1'
                    }
                }, 10)
        } else {
            // Show single image and metadata
            if (imageZoomContainer) imageZoomContainer.style.display = 'block'
            if (singleImg) singleImg.style.display = 'block'
            if (metadata) {
                var savedMetadataVisible = localStorage.getItem('hollyMetadataVisible') === 'true'
                metadata.style.display = savedMetadataVisible ? 'block' : 'none'
            }
            if (metadataToggle) metadataToggle.style.display = 'flex'
            if (downloadButton) downloadButton.style.display = 'block'
            var zoomSliderContainer = document.getElementById('holly-zoom-slider-container')
            if (zoomSliderContainer) zoomSliderContainer.style.display = 'flex'
        }
        },

        // Helper function to find batch images (images from the same generation)
        findBatchImages: function(currentIndex, images) {
            if (currentIndex < 0 || currentIndex >= images.length) return []

            const current = images[currentIndex]
            if (!current.text_to_image) return [current] // Not a generated image, return single

            // Use seed, prompt, and timestamp to identify batch images
            const batch = [current]
            const currentTimestamp = new Date(current.timestamp).getTime()
            const currentPrompt = current.text_to_image.prompt || ''
            const currentSeed = current.text_to_image.seed

            // Check images before current (they should be in chronological order)
            for (let i = currentIndex - 1; i >= 0; i--) {
                const img = images[i]
                if (!img.text_to_image) break

                const imgTimestamp = new Date(img.timestamp).getTime()
                const timeDiff = Math.abs(currentTimestamp - imgTimestamp)

                // Same prompt and seed (or just timestamp very close) = same batch
                const samePrompt = img.text_to_image.prompt === currentPrompt
                const sameSeed = currentSeed !== undefined && img.text_to_image.seed === currentSeed
                const closeTimestamp = timeDiff <= 2000 // Within 2 seconds

                if ((samePrompt && (sameSeed || closeTimestamp)) || (closeTimestamp && samePrompt)) {
                    batch.unshift(img) // Add to beginning
                } else {
                    break
                }
            }

            // Check images after current
            for (let i = currentIndex + 1; i < images.length; i++) {
                const img = images[i]
                if (!img.text_to_image) break

                const imgTimestamp = new Date(img.timestamp).getTime()
                const timeDiff = Math.abs(currentTimestamp - imgTimestamp)

                // Same prompt and seed (or just timestamp very close) = same batch
                const samePrompt = img.text_to_image.prompt === currentPrompt
                const sameSeed = currentSeed !== undefined && img.text_to_image.seed === currentSeed
                const closeTimestamp = timeDiff <= 2000 // Within 2 seconds

                if ((samePrompt && (sameSeed || closeTimestamp)) || (closeTimestamp && samePrompt)) {
                    batch.push(img)
                } else {
                    break
                }
            }

            // Only return batch if exactly 2 images
            return batch.length === 2 ? batch : [current]
        },

        // Close image viewer modal
        closeImageViewer: function() {
            // Remove keydown handler to prevent event stacking
            if (window.hollyImageViewerKeyHandler) {
                document.removeEventListener('keydown', window.hollyImageViewerKeyHandler, true)
                window.hollyImageViewerKeyHandler = null
            }

            // Remove touch handlers to prevent event stacking
            if (window.hollyImageViewerTouchHandlers) {
                var handlers = window.hollyImageViewerTouchHandlers
                if (handlers.container) {
                    handlers.container.removeEventListener('touchstart', handlers.start)
                    handlers.container.removeEventListener('touchmove', handlers.move)
                    handlers.container.removeEventListener('touchend', handlers.end)
                }
                window.hollyImageViewerTouchHandlers = null
            }

            if (imageViewerModal) {
                imageViewerModal.style.opacity = '0'
                imageViewerModal.style.transform = 'translate(-50%, -50%) scale(0.9)'

                // Remove backdrop
                var backdrop = document.querySelector('div[style*="z-index: 1000000"]')
                if (backdrop) {
                    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0)'
                    backdrop.style.backdropFilter = 'blur(0px)'
                    backdrop.style.webkitBackdropFilter = 'blur(0px)'
                }

                // Unlock body scroll when viewer closes (only if popup isn't open)
                if (!imagePopup || !imagePopup.parentNode) {
                    unlockBodyScroll()
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
                    controls.forEach(function(ctrl) {
                        if (ctrl.parentNode) ctrl.parentNode.removeChild(ctrl);
                    });
                }, 300)
            }
        },

        // Show image popup with grid of all chat images.
        showChatImages: function(messages, chatIndex, chatData) {
            this.closeImagePopup();
            var photoButtons = document.querySelectorAll('button');
            for (var i = 0; i < photoButtons.length; i++) {
                if (photoButtons[i].innerText && photoButtons[i].innerText.indexOf('Loading') !== -1) {
                    photoButtons[i].busy = false;
                    photoButtons[i].innerText = 'Images';
                    photoButtons[i].style.background = '#374151';
                    break;
                }
            }

        // Lock body scroll when popup opens
            lockBodyScroll()

        // Create backdrop overlay
            var self = this;
            var backdrop = document.createElement('div');
            backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0); z-index: 999998; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); transition: background-color 0.25s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease;';
            backdrop.onclick = function() { self.closeImagePopup(); };
            document.body.appendChild(backdrop);

        // Add ESC key listener
            var escHandler = function(e) {
            if (e.key === 'Escape') {
                    // Don't close popup if image viewer is open - let viewer handle ESC
                    if (typeof imageViewerModal !== 'undefined' && imageViewerModal && imageViewerModal.parentNode) {
                        return;
            }
                    self.closeImagePopup();
                    document.removeEventListener('keydown', escHandler);
        }
            };
            document.addEventListener('keydown', escHandler);

        // Debug: Log the first message structure to see what fields are available
            console.log('First message structure:', messages[0]);
            console.log('All message keys:', messages.map(function(m){return Object.keys(m)}));

        // Extract images from messages - get full-size images from both output_image_url and output_images
            const chatImages = [];

        // First, get character photos from the chat data (like the original script)
        // Use the chat data passed from the chat list, which contains the character photos
        if (chatData && chatData.chars) {
                console.log('Chat data with characters:', chatData);

                for (var charIndex = 0; charIndex < chatData.chars.length; charIndex++) {
                    var char = chatData.chars[charIndex];
                    console.log('Character ' + charIndex + ':', char);

                // Add character foreground photos (no checkboxes, like background photos)
                if (char.photos && char.photos.foreground && Array.isArray(char.photos.foreground)) {
                        console.log('Found character foreground photos:', char.photos.foreground);
                        for (var j = 0; j < char.photos.foreground.length; j++) {
                            var photoUrl = char.photos.foreground[j];
                            if (photoUrl && photoUrl.indexOf('http') === 0) {
                                console.log('Found character photo ' + (j + 1) + ':', photoUrl);
                            chatImages.push({
                                url: photoUrl,
                                    message: 'Character Photo ' + (j + 1),
                                    timestamp: messages[0] ? messages[0].created_at : (new Date()).toISOString(),
                                source: 'character.photos.foreground',
                                model: 'Character Photo'
                                });
                        }
                    }
                } else {
                        console.log('No character foreground photos found for character ' + charIndex);
                }

                // Add character background photos
                if (char.photos && char.photos.background && Array.isArray(char.photos.background)) {
                        console.log('Found character background photos:', char.photos.background);
                        for (var j = 0; j < char.photos.background.length; j++) {
                            var photoUrl = char.photos.background[j];
                            if (photoUrl && photoUrl.indexOf('http') === 0) {
                                console.log('Found character background ' + (j + 1) + ':', photoUrl);
                            chatImages.push({
                                url: photoUrl,
                                    message: 'Background Photo ' + (j + 1),
                                    timestamp: messages[0] ? messages[0].created_at : (new Date()).toISOString(),
                                source: 'character.photos.background',
                                model: 'Background Photo'
                                });
                        }
                    }
                }
            }
        }

        // Then get generated images from text_to_image messages
            for (var i = 0; i < messages.length; i++) {
                var msg = messages[i];

            if (msg.text_to_image) {
                    // Debug
                    console.log('=== MESSAGE WITH IMAGES ===');
                    console.log('Message UUID:', msg.uuid);
                    console.log('Message text:', msg.message);
                    console.log('text_to_image fields:', Object.keys(msg.text_to_image));
                    console.log('text_to_image full object:', JSON.stringify(msg.text_to_image, null, 2));

                // Get the main output_image_url (usually the first/primary image)
                if (msg.text_to_image.output_image_url) {
                        console.log('Found full-size image (primary):', msg.text_to_image.output_image_url);
                    chatImages.push({
                        url: msg.text_to_image.output_image_url,
                        message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                        timestamp: msg.created_at,
                        source: 'text_to_image.output_image_url',
                            model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                            text_to_image: msg.text_to_image
                        });
                }

                // Check ALL fields in text_to_image for potential image URLs
                    console.log('=== CHECKING ALL FIELDS FOR IMAGE URLS ===');
                    for (var pairIdx = 0; pairIdx < Object.keys(msg.text_to_image).length; pairIdx++) {
                        var key = Object.keys(msg.text_to_image)[pairIdx];
                        var value = msg.text_to_image[key];
                        if (key === 'output_image_url') continue;

                        if (typeof value === 'string' && value.indexOf('http') === 0 && value.indexOf('.jpg') !== -1) {
                            console.log("Found potential image URL in field '" + key + "':", value);

                            var isThumbnail = value.indexOf('-resized') !== -1
                                || value.indexOf('width%3D256') !== -1
                                || value.indexOf('width=256') !== -1
                                || value.indexOf('width%3D512') !== -1
                                || value.indexOf('width=512') !== -1
                                || value.indexOf('thumbnail') !== -1
                                || value.indexOf('thumb') !== -1
                                || value.indexOf('small') !== -1
                                || value.indexOf('preview') !== -1;

                            var urlNormalized = value.split('?')[0];
                            var primaryUrlNormalized = msg.text_to_image.output_image_url ? msg.text_to_image.output_image_url.split('?')[0] : '';
                        if (urlNormalized !== primaryUrlNormalized && !isThumbnail) {
                                console.log('This is a different full-size image from the primary!');
                            chatImages.push({
                                url: value,
                                message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                                timestamp: msg.created_at,
                                    source: 'text_to_image.' + key,
                                    model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                                    text_to_image: msg.text_to_image
                                });
                        } else if (isThumbnail) {
                                console.log("Skipping thumbnail image in field '" + key + "':", value);
                        }
                    } else if (Array.isArray(value)) {
                            console.log("Field '" + key + "' is an array with " + value.length + " items");
                            for (var j = 0; j < value.length; j++) {
                                var item = value[j];
                                if (typeof item === 'string' && item.indexOf('http') === 0 && item.indexOf('.jpg') !== -1) {
                                    console.log("Found potential image URL in array '" + key + "[" + j + "]':", item);
                                    var isThumbnailA = item.indexOf('-resized') !== -1
                                        || item.indexOf('width%3D256') !== -1
                                        || item.indexOf('width=256') !== -1
                                        || item.indexOf('width%3D512') !== -1
                                        || item.indexOf('width=512') !== -1
                                        || item.indexOf('thumbnail') !== -1
                                        || item.indexOf('thumb') !== -1
                                        || item.indexOf('small') !== -1
                                        || item.indexOf('preview') !== -1;
                                    if (item !== msg.text_to_image.output_image_url && !isThumbnailA) {
                                        console.log('This is a different full-size image from the primary!');
                                    chatImages.push({
                                        url: item,
                                        message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                                        timestamp: msg.created_at,
                                            source: 'text_to_image.'+key+"["+j+"]",
                                            model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                                            text_to_image: msg.text_to_image
                                        });
                                    } else if (isThumbnailA) {
                                        console.log("Skipping thumbnail image in array '" + key + "[" + j + "]':", item);
                                }
                            } else if (item && typeof item === 'object') {
                                    console.log("Array item '" + key + "[" + j + "]' is an object with keys:", Object.keys(item));
                                    for (var tupleIdx = 0; tupleIdx < Object.keys(item).length; tupleIdx++) {
                                        var subKey = Object.keys(item)[tupleIdx];
                                        var subValue = item[subKey];
                                        if (typeof subValue === 'string' && subValue.indexOf('http') === 0 && subValue.indexOf('.jpg') !== -1) {
                                            console.log("Found potential image URL in '" + key + "[" + j + "]." + subKey + "':", subValue);

                                            var isThumbnailB = subValue.indexOf('-resized') !== -1
                                                || subValue.indexOf('width%3D256') !== -1
                                                || subValue.indexOf('width=256') !== -1
                                                || subValue.indexOf('width%3D512') !== -1
                                                || subValue.indexOf('width=512') !== -1
                                                || subValue.indexOf('thumbnail') !== -1
                                                || subValue.indexOf('thumb') !== -1
                                                || subValue.indexOf('small') !== -1
                                                || subValue.indexOf('preview') !== -1;
                                            if (subValue !== msg.text_to_image.output_image_url && !isThumbnailB) {
                                                console.log('This is a different full-size image from the primary!');
                                            chatImages.push({
                                                url: subValue,
                                                message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                                                timestamp: msg.created_at,
                                                    source: 'text_to_image.'+key+"["+j+"]."+subKey,
                                                    model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                                                    text_to_image: msg.text_to_image
                                                });
                                            } else if (isThumbnailB) {
                                                console.log("Skipping thumbnail image in '" + key + "[" + j + "]." + subKey + "':", subValue);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Check for other possible image fields
                    var possibleImageFields = ['output_images', 'images', 'generated_images', 'result_images', 'full_images'];
                    for (var k = 0; k < possibleImageFields.length; k++) {
                        var fieldName = possibleImageFields[k];
                    if (msg.text_to_image[fieldName] && Array.isArray(msg.text_to_image[fieldName])) {
                            console.log('Found ' + fieldName + ' array with', msg.text_to_image[fieldName].length, 'images');
                            console.log('Full ' + fieldName + ' array:', msg.text_to_image[fieldName]);

                            for (var j = 0; j < msg.text_to_image[fieldName].length; j++) {
                                var img = msg.text_to_image[fieldName][j];
                                console.log(fieldName + "[" + j + "]:", img);
                                var imageUrl = null;

                                if (typeof img === 'string' && img.indexOf('http') === 0) {
                                    imageUrl = img;
                                    console.log('Found string URL in ' + fieldName + '[' + j + ']:', imageUrl);
                            } else if (img && typeof img === 'object') {
                                    console.log(fieldName + "[" + j + "] object keys:", Object.keys(img));
                                    imageUrl = img.url || img.src || img.image_url || img.link || img.href || img.full_url || img.original_url || img.image || img.thumbnail_url || img.full_image_url;
                                if (imageUrl) {
                                        console.log('Found object URL in ' + fieldName + '[' + j + ']:', imageUrl);
                                    }
                                }

                                if (imageUrl && imageUrl.indexOf('http') === 0) {
                                    var isThumbnailC = imageUrl.indexOf('-resized') !== -1
                                    || imageUrl.indexOf('width%3D256') !== -1
                                    || imageUrl.indexOf('width=256') !== -1
                                    || imageUrl.indexOf('width%3D512') !== -1
                                    || imageUrl.indexOf('width=512') !== -1
                                    || imageUrl.indexOf('thumbnail') !== -1
                                    || imageUrl.indexOf('thumb') !== -1
                                    || imageUrl.indexOf('small') !== -1
                                    || imageUrl.indexOf('preview') !== -1;

                                    if (!isThumbnailC) {
                                        console.log('Found additional full-size image in ' + fieldName + ':', imageUrl);
                                    chatImages.push({
                                        url: imageUrl,
                                        message: msg.message ? msg.message.substring(0, 100) + '...' : 'Generated Image',
                                        timestamp: msg.created_at,
                                            source: 'text_to_image.'+fieldName,
                                            model: msg.text_to_image.model_display_name || msg.text_to_image.model || 'Unknown Model',
                                            text_to_image: msg.text_to_image
                                        });
                                } else {
                                        console.log('Skipping thumbnail image in '+fieldName+':', imageUrl);
                                }
                            }
                        }
                    }
                }
            }
        }

            console.log('Found images:', chatImages);

        // Deduplicate images by URL (comparing normalized URLs to catch query parameter differences)
            var uniqueImages = [];
            var seenUrls = {};

            console.log('Before deduplication - all images:', chatImages.map(function(img){ return {url: img.url, source: img.source, model: img.model}; }));

        // Function to normalize URLs (remove query params for comparison)
            var normalizeUrl = function(url) {
                try {
                    var urlObj = new URL(url);
                    return urlObj.origin + urlObj.pathname;
                } catch (e) {
                    return url.split('?')[0];
                }
            };

            for (var i = 0; i < chatImages.length; i++) {
                var img = chatImages[i];
                var normalizedUrl = normalizeUrl(img.url);
                if (!seenUrls[normalizedUrl]) {
                    seenUrls[normalizedUrl] = true;
                    uniqueImages.push(img);
                    console.log('Added unique image:', { url: img.url, normalizedUrl: normalizedUrl, source: img.source, model: img.model });
            } else {
                    console.log('Skipped duplicate image:', { url: img.url, normalizedUrl: normalizedUrl, source: img.source, model: img.model });
            }
        }

            console.log('Unique images after deduplication:', uniqueImages.length);

        // Initialize pagination
            filteredImages = uniqueImages;
            totalImages = uniqueImages.length;
            currentPage = 1;

            imagePopup = document.createElement('div');
            imagePopup.className = 'image-popup';
            imagePopup.style.cssText = 'background-color: ' + colorScheme.background + '; border: 1px solid ' + colorScheme.border + '; border-radius: 12px; padding: 0; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); z-index: 999999; box-shadow: 0 8px 32px rgba(0,0,0,0.5); width: 90vw; max-width: 985px; height: 90vh; max-height: 860px; display: flex; flex-direction: column; overflow: hidden; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease;';

        if (uniqueImages.length === 0) {
                imagePopup.innerHTML =
                '<div style="color: ' + colorScheme.textSecondary + '; text-align: center; padding: 20px;">' +
                    '<div>No images found in this chat</div>' +
                    '<div style="font-size: 12px; margin-top: 10px; color: ' + colorScheme.textSecondary + ';">' +
                        'Check browser console for debug info' +
                    '</div>' +
                '</div>';
        } else {
                imagePopup.innerHTML =
                '<div style="display: flex; flex-direction: column; padding: clamp(12px, 3vw, 20px); border-bottom: 1px solid ' + colorScheme.border + '; flex-shrink: 0; gap: clamp(12px, 3vw, 16px);">' +
                    '<div style="display: flex; justify-content: space-between; align-items: center;">' +
                        '<div style="color: ' + colorScheme.textPrimary + '; font-weight: 600; font-size: clamp(16px, 4vw, 24px);">Chat Images (<span id="image-count">' + totalImages + '</span>)</div>' +
                        '<button id="close-image-modal" style="width: clamp(32px, 8vw, 40px); height: clamp(32px, 8vw, 40px); background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: none; border-radius: 8px; padding: clamp(6px, 1.5vw, 8px) clamp(12px, 3vw, 14px); cursor: pointer; font-size: clamp(12px, 3vw, 14px); font-weight: 500; transition: background-color 0.2s; white-space: nowrap; flex-shrink: 0;">✕</button>' +
                    '</div>' +
                    '<div style="display: flex; align-items: center; gap: clamp(8px, 2vw, 12px); flex-wrap: nowrap;">' +
                        '<select id="image-filter" style="background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 6px; padding: clamp(6px, 1.5vw, 8px) clamp(10px, 2.5vw, 14px); font-size: clamp(12px, 3vw, 14px); cursor: pointer; white-space: nowrap;">' +
                            '<option value="all">All Images</option>' +
                            '<option value="/image you">/image you</option>' +
                            '<option value="/image face">/image face</option>' +
                            '<option value="/image last">/image last</option>' +
                            '<option value="/image raw_last">/image raw_last</option>' +
                            '<option value="Character Photo">Character Photos</option>' +
                            '<option value="Background Photo">Backgrounds</option>' +
                        '</select>' +
                        '<button id="select-all-btn" style="background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 6px; padding: clamp(6px, 1.5vw, 8px) clamp(12px, 3vw, 16px); font-size: clamp(12px, 3vw, 14px); cursor: pointer; transition: background-color 0.2s; white-space: nowrap;">Select All</button>' +
                        '<button id="download-selected-btn" title="Download selected images" style="background: ' + colorScheme.gradient + '; color: black; border: none; border-radius: 6px; padding: clamp(6px, 1.5vw, 8px); width: clamp(32px, 8vw, 40px); height: clamp(32px, 8vw, 40px); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>' +
                    '</div>' +
                '</div>' +
                '<div id="images-grid" style="display: flex; align-content: flex-start; gap: clamp(8px, 2vw, 16px); padding: clamp(12px, 3vw, 20px); flex-wrap: wrap; overflow-y: auto; flex: 1; min-height: 0;">' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between; align-items: center; padding: clamp(8px, 2vw, 12px) clamp(12px, 3vw, 20px); border-top: 1px solid ' + colorScheme.border + '; flex-shrink: 0; background: ' + colorScheme.cardBackground + '; flex-wrap: wrap; gap: clamp(8px, 2vw, 12px);">' +
                    '<div style="display: flex; align-items: center; gap: clamp(6px, 1.5vw, 12px); flex-wrap: wrap;">' +
                        '<span style="color: ' + colorScheme.textSecondary + '; font-size: clamp(10px, 2.5vw, 12px); white-space: nowrap;">Show:</span>' +
                        '<select id="page-size-select" style="background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 4px; padding: clamp(2px, 0.5vw, 4px) clamp(6px, 1.5vw, 8px); font-size: clamp(10px, 2.5vw, 12px); cursor: pointer;">' +
                            '<option value="8">8</option>' +
                            '<option value="20" selected>20</option>' +
                            '<option value="50">50</option>' +
                        '</select>' +
                    '</div>' +
                    '<div style="display: flex; align-items: center; gap: clamp(6px, 1.5vw, 12px); flex-wrap: wrap;">' +
                        '<button id="prev-page-btn" style="background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 4px; padding: clamp(4px, 1vw, 6px) clamp(8px, 2vw, 12px); font-size: clamp(10px, 2.5vw, 12px); cursor: pointer; transition: background-color 0.2s; white-space: nowrap;"><</button>' +
                        '<span id="page-info" style="color: ' + colorScheme.textPrimary + '; font-size: clamp(10px, 2.5vw, 12px); white-space: nowrap;">1-20 of ' + totalImages + '</span>' +
                        '<button id="next-page-btn" style="background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 4px; padding: clamp(4px, 1vw, 6px) clamp(8px, 2vw, 12px); font-size: clamp(10px, 2.5vw, 12px); cursor: pointer; transition: background-color 0.2s; white-space: nowrap;">></button>' +
                        '<span style="color: ' + colorScheme.textSecondary + '; font-size: clamp(10px, 2.5vw, 12px); white-space: nowrap;"></span>' +
                        '<select id="page-jump-select" style="background: ' + colorScheme.cardBackground + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 4px; padding: clamp(2px, 0.5vw, 4px) clamp(6px, 1.5vw, 8px); font-size: clamp(10px, 2.5vw, 12px); cursor: pointer;">' +
                        '</select>' +
                    '</div>' +
                '</div>';
            }

            // Add event listeners in a timeout
            setTimeout(function() {
                var closeBtn = imagePopup.querySelector('#close-image-modal');
                if (closeBtn) {
                    closeBtn.addEventListener('click', function(){ self.closeImagePopup(); });
                    // Add hover effects to match export modal close button
                    closeBtn.addEventListener('mouseenter', function() {
                        this.style.backgroundColor = colorScheme.hoverBackground;
                    });
                    closeBtn.addEventListener('mouseleave', function() {
                        this.style.backgroundColor = colorScheme.cardBackground;
                    });
                }

                var filterSelect = imagePopup.querySelector('#image-filter');
                if (filterSelect) {
                    filterSelect.addEventListener('change', function() {
                        ImageManager.filterImages(uniqueImages, this.value);
                    });
                }

                var selectAllBtn = imagePopup.querySelector('#select-all-btn');
                if (selectAllBtn) {
                    selectAllBtn.addEventListener('click', function() {
                        var checkboxes = imagePopup.querySelectorAll('.image-checkbox');
                        var allChecked = Array.prototype.every.call(checkboxes, function(cb) { return cb.checked; });

                        for (var i = 0; i < checkboxes.length; i++) {
                            checkboxes[i].checked = !allChecked;
                        }

                        this.textContent = allChecked ? 'Select All' : 'Deselect All';
                    });
                }

                // Pagination controls
                var pageSizeSelect = imagePopup.querySelector('#page-size-select');
                if (pageSizeSelect) {
                    pageSizeSelect.addEventListener('change', function() {
                        pageSize = parseInt(this.value, 10);
                        currentPage = 1;
                        ImageManager.updatePaginationControls();
                        ImageManager.displayCurrentPage();
                    });
                }

                var prevBtn = imagePopup.querySelector('#prev-page-btn');
                if (prevBtn) {
                    prevBtn.addEventListener('click', function() {
                        if (currentPage > 1) {
                            currentPage--;
                            ImageManager.updatePaginationControls();
                            ImageManager.displayCurrentPage();
                        }
                    });
                }

                var nextBtn = imagePopup.querySelector('#next-page-btn');
                if (nextBtn) {
                    nextBtn.addEventListener('click', function() {
                        var totalPages = Math.ceil(totalImages / pageSize);
                        if (currentPage < totalPages) {
                            currentPage++;
                            ImageManager.updatePaginationControls();
                            ImageManager.displayCurrentPage();
                        }
                    });
                }

                var pageJumpSelect = imagePopup.querySelector('#page-jump-select');
                if (pageJumpSelect) {
                    pageJumpSelect.addEventListener('change', function() {
                        var selectedPage = parseInt(this.value, 10);
                        if (selectedPage >= 1 && selectedPage <= Math.ceil(totalImages / pageSize)) {
                            currentPage = selectedPage;
                            ImageManager.updatePaginationControls();
                            ImageManager.displayCurrentPage();
                        }
                    });
                }

                // Initialize display
                ImageManager.updatePaginationControls();
                ImageManager.displayCurrentPage();

                var downloadSelectedBtn = imagePopup.querySelector('#download-selected-btn');
                if (downloadSelectedBtn) {
                    // Add hover effects
                    downloadSelectedBtn.addEventListener('mouseenter', function() {
                        this.style.background = colorScheme.hoverBackground;
                        this.style.color = colorScheme.hoverText;
                    });
                    downloadSelectedBtn.addEventListener('mouseleave', function() {
                        this.style.background = colorScheme.gradient;
                        this.style.color = 'black';
                    });

                    downloadSelectedBtn.addEventListener('click', function() {
                        // Get all checked images from all pages by collecting URLs from checked checkboxes
                        var checkedBoxes = imagePopup.querySelectorAll('.image-checkbox:checked');
                        var checkedUrls = {};
                        // Store as object for speed
                        for (var i = 0; i < checkedBoxes.length; i++) {
                            checkedUrls[checkedBoxes[i].dataset.url] = true;
                        }

                        // Find all images that match the checked URLs from the filtered images
                        var imagesToDownload = [];
                        for (var i = 0; i < filteredImages.length; i++) {
                            if (checkedUrls[filteredImages[i].url]) {
                                imagesToDownload.push(filteredImages[i]);
                            }
                        }

                        console.log('Download selected clicked. Found checked boxes:', checkedBoxes.length);
                        console.log('Images to download:', imagesToDownload.length);
                        console.log('Images details:', imagesToDownload.map(function(img) {
                            return {
                                url: img.url,
                                filename: img.message.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_' + (new Date(img.timestamp)).toISOString().split('T')[0] + '.jpg'
                            };
                        }));

                        if (imagesToDownload.length === 0) {
                            alert('Please select at least one image to download.');
                            return;
                        }

                        // Show loading state
                        var btn = this;
                        var svg = btn.querySelector('svg');
                        var originalTitle = btn.title;
                        btn.title = 'Downloading...';
                        btn.disabled = true;
                        if (svg) svg.style.opacity = '0.5';

                        // Create progress indicator for image downloads
                        var progressContainer = document.createElement('div');
                        progressContainer.className = 'holly-export-progress';
                        progressContainer.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000010; background: ' + colorScheme.cardBackground + '; border: 1px solid ' + colorScheme.border + '; border-radius: 12px; padding: 20px; min-width: 300px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.5); cursor: move; user-select: none;';

                        // Create header with title and minimize button
                        var headerRow = document.createElement('div');
                        headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; cursor: move;';

                        var progressTitle = document.createElement('div');
                        progressTitle.textContent = 'Downloading Images...';
                        progressTitle.style.cssText = 'color: ' + colorScheme.textPrimary + '; font-weight: 600; font-size: 16px; flex: 1;';

                        // Create minimize button
                        var minimizeBtn = document.createElement('button');
                        minimizeBtn.innerHTML = '−';
                        minimizeBtn.style.cssText = 'background: transparent; color: ' + colorScheme.textPrimary + '; border: none; border-radius: 4px; padding: 4px 8px; font-size: 18px; cursor: pointer; transition: all 0.2s; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; line-height: 1;';
                        minimizeBtn.title = 'Minimize';
                        minimizeBtn.addEventListener('mouseenter', function() {
                            this.style.backgroundColor = colorScheme.hoverBackground;
                            this.style.color = colorScheme.hoverText;
                        });
                        minimizeBtn.addEventListener('mouseleave', function() {
                            this.style.backgroundColor = 'transparent';
                            this.style.color = colorScheme.textPrimary;
                        });

                        headerRow.appendChild(progressTitle);
                        headerRow.appendChild(minimizeBtn);

                        var progressBarContainer = document.createElement('div');
                        progressBarContainer.style.cssText = 'width: 100%; height: 8px; background: ' + colorScheme.border + '; border-radius: 4px; overflow: hidden; margin-bottom: 8px;';

                        var progressBar = document.createElement('div');
                        progressBar.style.cssText = 'height: 100%; background: ' + colorScheme.gradient + '; width: 0%; transition: width 0.3s ease; border-radius: 4px;';

                        var progressText = document.createElement('div');
                        progressText.className = 'holly-progress-text';
                        progressText.style.cssText = 'color: ' + colorScheme.textSecondary + '; font-size: 12px; text-align: center; margin-bottom: 12px;';
                        progressText.textContent = 'Preparing download...';

                        // Create cancel button
                        var cancelBtn = document.createElement('button');
                        cancelBtn.textContent = 'Cancel';
                        cancelBtn.style.cssText = 'background: ' + colorScheme.border + '; color: ' + colorScheme.textPrimary + '; border: 1px solid ' + colorScheme.border + '; border-radius: 6px; padding: 8px 16px; font-size: 14px; cursor: pointer; transition: all 0.2s; width: 100%; margin-top: 8px;';
                        cancelBtn.addEventListener('mouseenter', function() {
                            this.style.backgroundColor = colorScheme.hoverBackground;
                            this.style.borderColor = colorScheme.hoverText;
                        });
                        cancelBtn.addEventListener('mouseleave', function() {
                            this.style.backgroundColor = colorScheme.border;
                            this.style.borderColor = colorScheme.border;
                        });

                        // Create full content container (shown when not minimized)
                        var fullContent = document.createElement('div');
                        fullContent.className = 'holly-progress-full-content';
                        fullContent.style.cssText = 'display: block;';
                        fullContent.appendChild(progressBarContainer);
                        fullContent.appendChild(progressText);
                        fullContent.appendChild(cancelBtn);

                        // Create minimized content container (shown when minimized)
                        var minimizedContent = document.createElement('div');
                        minimizedContent.className = 'holly-progress-minimized-content';
                        minimizedContent.style.cssText = 'display: none; align-items: center; gap: 12px; cursor: move;';

                        // Minimized progress bar
                        var minimizedProgressBarContainer = document.createElement('div');
                        minimizedProgressBarContainer.style.cssText = 'flex: 1; height: 6px; background: ' + colorScheme.border + '; border-radius: 3px; overflow: hidden;';
                        var minimizedProgressBar = document.createElement('div');
                        minimizedProgressBar.style.cssText = 'height: 100%; background: ' + colorScheme.gradient + '; width: 0%; transition: width 0.3s ease; border-radius: 3px;';
                        minimizedProgressBarContainer.appendChild(minimizedProgressBar);

                        // Minimized count text
                        var minimizedCountText = document.createElement('div');
                        minimizedCountText.className = 'holly-progress-minimized-count';
                        minimizedCountText.style.cssText = 'color: ' + colorScheme.textPrimary + '; font-size: 12px; font-weight: 500; white-space: nowrap; min-width: 60px; text-align: center;';
                        minimizedCountText.textContent = '0/0';

                        // Minimized minimize button (to expand)
                        var minimizedMinimizeBtn = document.createElement('button');
                        minimizedMinimizeBtn.innerHTML = '+';
                        minimizedMinimizeBtn.style.cssText = 'background: transparent; color: ' + colorScheme.textPrimary + '; border: none; border-radius: 4px; padding: 4px 8px; font-size: 16px; cursor: pointer; transition: all 0.2s; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;';
                        minimizedMinimizeBtn.title = 'Restore';
                        minimizedMinimizeBtn.addEventListener('mouseenter', function() {
                            this.style.backgroundColor = colorScheme.hoverBackground;
                            this.style.color = colorScheme.hoverText;
                        });
                        minimizedMinimizeBtn.addEventListener('mouseleave', function() {
                            this.style.backgroundColor = 'transparent';
                            this.style.color = colorScheme.textPrimary;
                        });

                        // Minimized close button (✕)
                        var minimizedCloseBtn = document.createElement('button');
                        minimizedCloseBtn.innerHTML = '✕';
                        minimizedCloseBtn.style.cssText = 'background: transparent; color: ' + colorScheme.textPrimary + '; border: none; border-radius: 4px; padding: 4px 8px; font-size: 16px; cursor: pointer; transition: all 0.2s; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;';
                        minimizedCloseBtn.title = 'Close';
                        minimizedCloseBtn.addEventListener('mouseenter', function() {
                            this.style.backgroundColor = colorScheme.hoverBackground;
                            this.style.color = colorScheme.hoverText;
                        });
                        minimizedCloseBtn.addEventListener('mouseleave', function() {
                            this.style.backgroundColor = 'transparent';
                            this.style.color = colorScheme.textPrimary;
                        });
                        minimizedCloseBtn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            // Use same logic as cancelBtn - check if it says "Close" or "Cancel"
                            if (cancelBtn.textContent === 'Close') {
                                // Just close the modal
                                // Use current position if modal was dragged, otherwise center
                                var computedStyle = window.getComputedStyle(progressContainer);
                                var currentTransform = computedStyle.transform;
                                var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)';
                                
                                progressContainer.style.opacity = '0';
                                if (hasTransform) {
                                    progressContainer.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                } else {
                                    // Modal was dragged, use scale on current position
                                    progressContainer.style.transform = 'scale(0.95)';
                                }
                                setTimeout(function() {
                                    if (progressContainer && progressContainer.parentNode) {
                                        progressContainer.parentNode.removeChild(progressContainer);
                                    }
                                }, 300);
                                // Reset button state
                                btn.title = originalTitle;
                                btn.disabled = false;
                                if (svg) svg.style.opacity = '1';
                            } else {
                                // Cancel downloads in progress
                                cancelState.cancelled = true;
                                // Close progress indicator
                                progressContainer.style.opacity = '0';
                                progressContainer.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                setTimeout(function() {
                                    if (progressContainer && progressContainer.parentNode) {
                                        progressContainer.parentNode.removeChild(progressContainer);
                                    }
                                }, 300);
                                // Reset button state
                                btn.title = originalTitle;
                                btn.disabled = false;
                                if (svg) svg.style.opacity = '1';
                            }
                        });

                        minimizedContent.appendChild(minimizedProgressBarContainer);
                        minimizedContent.appendChild(minimizedCountText);
                        minimizedContent.appendChild(minimizedMinimizeBtn);
                        minimizedContent.appendChild(minimizedCloseBtn);

                        progressBarContainer.appendChild(progressBar);
                        progressContainer.appendChild(headerRow);
                        progressContainer.appendChild(fullContent);
                        progressContainer.appendChild(minimizedContent);
                        progressContainer.style.opacity = '0';
                        document.body.appendChild(progressContainer);

                        // Drag functionality
                        var isDragging = false;
                        var dragOffsetX = 0;
                        var dragOffsetY = 0;
                        var currentX = 0;
                        var currentY = 0;

                        // Helper function to check if target is interactive
                        function isInteractiveElement(target) {
                            if (!target) return false;
                            var tagName = target.tagName;
                            // Check if it's a button or inside a button
                            if (tagName === 'BUTTON' || target.closest('button')) {
                                return true;
                            }
                            // Check if it's an input or other interactive element
                            if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
                                return true;
                            }
                            // Check if it's inside an input/textarea/select
                            if (target.closest('input') || target.closest('textarea') || target.closest('select')) {
                                return true;
                            }
                            return false;
                        }

                        function startDrag(e) {
                            // Don't start drag if clicking on interactive elements
                            if (isInteractiveElement(e.target)) {
                                return;
                            }
                            
                            // Check if we need to convert from transform-based to left/top positioning
                            var computedStyle = window.getComputedStyle(progressContainer);
                            var currentTransform = computedStyle.transform;
                            var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)';
                            
                            // Get current visual position first
                            var rect = progressContainer.getBoundingClientRect();
                            
                            if (hasTransform) {
                                // Convert from transform-based positioning to left/top positioning
                                currentX = rect.left;
                                currentY = rect.top;
                                progressContainer.style.top = currentY + 'px';
                                progressContainer.style.left = currentX + 'px';
                                progressContainer.style.transform = 'none';
                                // Force a reflow to ensure the new position is applied
                                progressContainer.offsetHeight;
                            } else {
                                // Already using left/top positioning, use current visual position
                                currentX = rect.left;
                                currentY = rect.top;
                            }
                            
                            // Calculate drag offset from where the mouse clicked relative to the container's current position
                            dragOffsetX = e.clientX - currentX;
                            dragOffsetY = e.clientY - currentY;
                            
                            isDragging = true;
                            progressContainer.style.cursor = 'grabbing';
                            e.preventDefault();
                        }

                        function drag(e) {
                            if (!isDragging) return;
                            e.preventDefault();
                            currentX = e.clientX - dragOffsetX;
                            currentY = e.clientY - dragOffsetY;

                            // Constrain to viewport
                            var maxX = window.innerWidth - progressContainer.offsetWidth;
                            var maxY = window.innerHeight - progressContainer.offsetHeight;
                            currentX = Math.max(0, Math.min(currentX, maxX));
                            currentY = Math.max(0, Math.min(currentY, maxY));

                            progressContainer.style.left = currentX + 'px';
                            progressContainer.style.top = currentY + 'px';
                            progressContainer.style.transform = 'none';
                        }

                        function stopDrag() {
                            if (isDragging) {
                                isDragging = false;
                                progressContainer.style.cursor = 'move';
                            }
                        }

                        headerRow.addEventListener('mousedown', startDrag);
                        // Also allow dragging from minimized content area (but not buttons)
                        minimizedContent.addEventListener('mousedown', function(e) {
                            if (!isInteractiveElement(e.target)) {
                                startDrag(e);
                            }
                        });
                        // Allow dragging from anywhere in the progress container (padding areas)
                        progressContainer.addEventListener('mousedown', function(e) {
                            if (!isInteractiveElement(e.target)) {
                                startDrag(e);
                            }
                        });
                        document.addEventListener('mousemove', drag);
                        document.addEventListener('mouseup', stopDrag);

                        // Minimize functionality
                        var isMinimized = false;
                        function toggleMinimize() {
                            isMinimized = !isMinimized;
                            if (isMinimized) {
                                // Switch to minimized view
                                fullContent.style.display = 'none';
                                minimizedContent.style.display = 'flex';
                                headerRow.style.display = 'none'; // Hide header in minimized mode
                                progressContainer.style.minWidth = '250px';
                                progressContainer.style.width = 'auto';
                                progressContainer.style.padding = '6px 10px';
                                minimizeBtn.innerHTML = '+';
                                minimizeBtn.title = 'Restore';
                            } else {
                                // Switch to full view
                                fullContent.style.display = 'block';
                                minimizedContent.style.display = 'none';
                                headerRow.style.display = 'flex'; // Show header in full mode
                                progressContainer.style.minWidth = '300px';
                                progressContainer.style.width = 'auto';
                                progressContainer.style.padding = '20px';
                                minimizeBtn.innerHTML = '−';
                                minimizeBtn.title = 'Minimize';
                            }
                        }

                        minimizeBtn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            toggleMinimize();
                        });

                        minimizedMinimizeBtn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            toggleMinimize();
                        });

                        // Fade in animation
                        requestAnimationFrame(function() {
                            requestAnimationFrame(function() {
                                progressContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                                progressContainer.style.opacity = '1';
                            });
                        });

                        // Cancel flag for image downloads (use object reference so closure can access it)
                        var cancelState = { cancelled: false };
                        cancelBtn.addEventListener('click', function() {
                            // Check if button says "Close" (downloads complete) or "Cancel" (still downloading)
                            if (this.textContent === 'Close') {
                                // Just close the modal, don't cancel downloads
                                // Use current position if modal was dragged, otherwise center
                                var computedStyle = window.getComputedStyle(progressContainer);
                                var currentTransform = computedStyle.transform;
                                var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)';
                                
                                progressContainer.style.opacity = '0';
                                if (hasTransform) {
                                    progressContainer.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                } else {
                                    // Modal was dragged, use scale on current position
                                    progressContainer.style.transform = 'scale(0.95)';
                                }
                                setTimeout(function() {
                                    if (progressContainer && progressContainer.parentNode) {
                                        progressContainer.parentNode.removeChild(progressContainer);
                                    }
                                }, 300);
                                // Reset button state
                                btn.title = originalTitle;
                                btn.disabled = false;
                                if (svg) svg.style.opacity = '1';
                            } else {
                                // Cancel downloads in progress
                                cancelState.cancelled = true;
                                // Close progress indicator
                                // Use current position if modal was dragged, otherwise center
                                var computedStyle = window.getComputedStyle(progressContainer);
                                var currentTransform = computedStyle.transform;
                                var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)';
                                
                                progressContainer.style.opacity = '0';
                                if (hasTransform) {
                                    progressContainer.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                } else {
                                    // Modal was dragged, use scale on current position
                                    progressContainer.style.transform = 'scale(0.95)';
                                }
                                setTimeout(function() {
                                    if (progressContainer && progressContainer.parentNode) {
                                        progressContainer.parentNode.removeChild(progressContainer);
                                    }
                                }, 300);
                                // Reset button state
                                btn.title = originalTitle;
                                btn.disabled = false;
                                if (svg) svg.style.opacity = '1';
                            }
                        });

                        // Download sequential batches so we can use async/await in ES5
                        (function(btnRef, svgRef, originalTitleRef, progressContainerRef, progressBarRef, progressTextRef, cancelStateRef, minimizedProgressBarRef, minimizedCountTextRef, cancelBtnRef){
                            var batchSize = 5;
                            var batchDelay = 1000; // 1 second delay between batches
                            var results = [];
                            var successful = 0;
                            var failed = 0;
                            var totalImages = imagesToDownload.length;
                            var totalBatches = Math.ceil(totalImages / batchSize);

                            // Function to update both progress bars and counts
                            function updateProgress(current, total) {
                                var percent = Math.min(95, (current / total) * 95);
                                progressBarRef.style.width = percent + '%';
                                if (minimizedProgressBarRef) {
                                    minimizedProgressBarRef.style.width = percent + '%';
                                }
                                if (minimizedCountTextRef) {
                                    minimizedCountTextRef.textContent = current + '/' + total;
                                }
                            }

                            // Helper to download single image
                            function downloadSingle(img, index, cb) {
                                var url = img.url;
                                var filename = img.message.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_' + (new Date(img.timestamp)).toISOString().split('T')[0] + '.jpg';

                                // Check if cancelled before starting download
                                if (cancelStateRef && cancelStateRef.cancelled) {
                                    console.log('Download cancelled before starting: ' + filename);
                                    return; // Don't call callback, just return
                                }
                                var globalIndex = index + 1;

                                console.log('Starting download ' + globalIndex + '/' + imagesToDownload.length + ': ' + filename);

                                // Check if this is a CORS-protected URL (character photos)
                                var isCorsProtected = url.indexOf('characterphotos.yodayo.com') !== -1;

                                if (isCorsProtected) {
                                    // For CORS-protected images, open in new tab for manual download
                                    console.log('Opening CORS-protected image in new tab: ' + filename);

                                    setTimeout(function() {
                                        // Check if cancelled before opening tab
                                        if (cancelStateRef && cancelStateRef.cancelled) {
                                            console.log('Download cancelled before opening tab: ' + filename);
                                            return;
                                        }

                                        var newTab = window.open(url, '_blank');
                                        if (newTab) {
                                            console.log('Opened ' + filename + ' in new tab for manual download');
                                            cb({ success: true, filename: filename, method: 'new_tab', note: 'Please right-click and save the image' });
                                        } else {
                                            console.log('Failed to open new tab for ' + filename);
                                            cb({ success: false, filename: filename, error: 'Popup blocked' });
                                        }
                                    }, index * 200);
                                } else {
                                    // For regular images, use fetch method
                                    console.log('Attempting fetch for: ' + filename);

                                    fetch(url)
                                        .then(function(response) {
                                            // Check if cancelled before processing response
                                            if (cancelStateRef && cancelStateRef.cancelled) {
                                                console.log('Download cancelled during fetch: ' + filename);
                                                return null; // Return null to indicate cancellation
                                            }

                                            if (!response.ok) throw new Error('HTTP error! status: ' + response.status);
                                            return response.blob();
                                        })
                                        .then(function(blob) {
                                            // Check if cancelled before creating download link
                                            if (cancelStateRef && cancelStateRef.cancelled) {
                                                console.log('Download cancelled before creating link: ' + filename);
                                                return;
                                            }

                                            if (!blob) return; // Cancelled during fetch

                                            var blobUrl = URL.createObjectURL(blob);
                                            var link = document.createElement('a');
                                            link.href = blobUrl;
                                            link.download = filename;
                                            link.style.display = 'none';
                                            document.body.appendChild(link);
                                            link.click();
                                            document.body.removeChild(link);
                                            setTimeout(function(){ URL.revokeObjectURL(blobUrl); }, 2000);
                                            console.log('Successfully downloaded: ' + filename);
                                            cb({ success: true, filename: filename, method: 'fetch_download' });
                                        })
                                        .catch(function(error) {
                                            // Don't log error if cancelled
                                            if (cancelStateRef && cancelStateRef.cancelled) {
                                                console.log('Download cancelled (error ignored): ' + filename);
                                                return;
                                            }
                                            console.error('Failed to download ' + filename + ':', error);
                                            cb({ success: false, filename: filename, error: error });
                                        });
                                }
                            }

                            // Batch/sequential download
                            var batchStart = 0;
                            function doBatch() {
                                // Check if cancelled
                                if (cancelStateRef && cancelStateRef.cancelled) {
                                    console.log('Download cancelled - stopping batch processing');
                                    return;
                                }

                                if (batchStart >= imagesToDownload.length) {
                                    console.log('Download complete: ' + successful + ' successful, ' + failed + ' failed');

                                    // Complete progress bar
                                    updateProgress(successful, totalImages);
                                    progressBarRef.style.width = '100%';
                                    if (minimizedProgressBarRef) {
                                        minimizedProgressBarRef.style.width = '100%';
                                    }
                                    progressTextRef.textContent = 'Download complete! ' + successful + ' successful, ' + failed + ' failed';

                                    // Change cancel button to "Close"
                                    if (cancelBtnRef) {
                                        cancelBtnRef.textContent = 'Close';
                                        console.log('Changed cancel button to Close');
                                    } else {
                                        // Fallback: try to find cancel button in DOM (inside fullContent)
                                        var fullContent = progressContainerRef.querySelector('.holly-progress-full-content');
                                        if (fullContent) {
                                            var buttons = fullContent.querySelectorAll('button');
                                            for (var b = 0; b < buttons.length; b++) {
                                                if (buttons[b].textContent.trim() === 'Cancel') {
                                                    buttons[b].textContent = 'Close';
                                                    console.log('Found and updated cancel button via DOM query');
                                                    break;
                                                }
                                            }
                                        }
                                    }

                                    // Auto-close if enabled (defaults to true if preference not set)
                                    if (localStorage.getItem('hollyAutoCloseProgress') !== 'false') {
                                        setTimeout(function() {
                                            if (progressContainerRef && progressContainerRef.parentNode) {
                                                progressContainerRef.style.opacity = '0';
                                                progressContainerRef.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                                setTimeout(function() {
                                                    if (progressContainerRef && progressContainerRef.parentNode) {
                                                        progressContainerRef.parentNode.removeChild(progressContainerRef);
                                                    }
                                                }, 300);
                                            }
                                            // Reset button state
                                            btnRef.title = originalTitleRef;
                                            btnRef.disabled = false;
                                            if (svgRef) svgRef.style.opacity = '1';
                                        }, 2000);
                                    } else {
                                        // Reset button state (if not auto-closing)
                                        btnRef.title = originalTitleRef;
                                        btnRef.disabled = false;
                                        if (svgRef) svgRef.style.opacity = '1';
                                    }
                                    return;
                                }

                                var batch = imagesToDownload.slice(batchStart, batchStart + batchSize);
                                var batchNumber = Math.floor(batchStart / batchSize) + 1;

                                console.log('Processing batch ' + batchNumber + '/' + totalBatches + ' (' + batch.length + ' images)');

                                // Update progress indicator at start of batch
                                updateProgress(successful, totalImages);
                                progressTextRef.textContent = 'Downloading batch ' + batchNumber + '/' + totalBatches + '... (' + successful + ' downloaded)';

                                btnRef.title = 'Downloading batch ' + batchNumber + '/' + totalBatches + '...';

                                // Download all in batch, callback after all finish
                                var finished = 0;
                                var batchResults = [];
                                function finishOne(result) {
                                    // Check if cancelled before processing result
                                    if (cancelStateRef && cancelStateRef.cancelled) {
                                        console.log('Download cancelled - ignoring batch result');
                                        return;
                                    }

                                    batchResults.push(result);
                                    if (result.success) successful++;
                                    else failed++;
                                    finished++;
                                    if (finished === batch.length) {
                                        // Check if cancelled after batch completes
                                        if (cancelStateRef && cancelStateRef.cancelled) {
                                            console.log('Download cancelled after batch complete');
                                            return;
                                        }

                                        results = results.concat(batchResults);
                                        console.log('Batch ' + batchNumber + ' complete: ' + successful + ' successful, ' + failed + ' failed so far');

                                        // Update progress after batch completes
                                        updateProgress(successful, totalImages);
                                        progressTextRef.textContent = 'Completed batch ' + batchNumber + '/' + totalBatches + ' (' + successful + ' downloaded)';

                                        batchStart += batchSize;
                                        if (batchStart < imagesToDownload.length) {
                                            // Check if cancelled before scheduling next batch
                                            if (cancelStateRef && cancelStateRef.cancelled) {
                                                console.log('Download cancelled before next batch');
                                                return;
                                            }
                                            console.log('Waiting ' + batchDelay + 'ms before next batch...');
                                            setTimeout(function() {
                                                if (!cancelStateRef || !cancelStateRef.cancelled) {
                                                    doBatch();
                                                } else {
                                                    console.log('Download cancelled during batch delay');
                                                }
                                            }, batchDelay);
                                        } else {
                                            // This case is handled at the start of doBatch, but keeping for safety
                                            console.log('Download complete: ' + successful + ' successful, ' + failed + ' failed');
                                            // Change cancel button to "Close"
                                            if (cancelBtnRef) {
                                                cancelBtnRef.textContent = 'Close';
                                            } else {
                                                // Fallback: try to find cancel button in DOM (inside fullContent)
                                                var fullContent = progressContainerRef.querySelector('.holly-progress-full-content');
                                                if (fullContent) {
                                                    var buttons = fullContent.querySelectorAll('button');
                                                    for (var b = 0; b < buttons.length; b++) {
                                                        if (buttons[b].textContent.trim() === 'Cancel') {
                                                            buttons[b].textContent = 'Close';
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            // Auto-close if enabled (defaults to true if preference not set)
                                            if (localStorage.getItem('hollyAutoCloseProgress') !== 'false') {
                                                setTimeout(function() {
                                                    if (progressContainerRef && progressContainerRef.parentNode) {
                                                        progressContainerRef.style.opacity = '0';
                                                        progressContainerRef.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                                        setTimeout(function() {
                                                            if (progressContainerRef && progressContainerRef.parentNode) {
                                                                progressContainerRef.parentNode.removeChild(progressContainerRef);
                                                            }
                                                        }, 300);
                                                    }
                                                    // Reset button state
                                                    btnRef.title = originalTitleRef;
                                                    btnRef.disabled = false;
                                                    if (svgRef) svgRef.style.opacity = '1';
                                                }, 2000);
                                            } else {
                                                // Reset button state (if not auto-closing)
                                                btnRef.title = originalTitleRef;
                                                btnRef.disabled = false;
                                                if (svgRef) svgRef.style.opacity = '1';
                                            }
                                        }
                                    }
                                }

                                for (var k = 0; k < batch.length; k++) {
                                    // Check if cancelled before starting each download
                                    if (cancelStateRef && cancelStateRef.cancelled) {
                                        console.log('Download cancelled - stopping batch downloads');
                                        return;
                                    }

                                    (function(img, idx) {
                                        downloadSingle(img, batchStart + idx, finishOne);
                                    })(batch[k], k);
                                }
                            }

                            // Initialize progress display
                            updateProgress(0, totalImages);

                            doBatch();
                        })(btn, svg, originalTitle, progressContainer, progressBar, progressText, cancelState, minimizedProgressBar, minimizedCountText, cancelBtn);
                    });
                }
            }, 100);

            // Append the popup to the body for proper centering
            document.body.appendChild(imagePopup);

            // Trigger animation
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
                    backdrop.style.backdropFilter = 'blur(4px)';
                    backdrop.style.webkitBackdropFilter = 'blur(4px)';
                    imagePopup.style.opacity = '1';
                    imagePopup.style.transform = 'translate(-50%, -50%) scale(1)';
                });
            });
        },

        // Filter images in popup grid
        filterImages: function(images, filterValue) {
            var grid = document.querySelector('#images-grid');
            var countSpan = document.querySelector('#image-count');

            if (!grid || !countSpan) return;

            // Apply filter
            filteredImages = images;
            if (filterValue !== 'all') {
                filteredImages = images.filter(function(img) {
                    return img.message && img.message.indexOf(filterValue) !== -1;
                });
            }

            // Reset to first page when filtering
            currentPage = 1;
            totalImages = filteredImages.length;

            // Update count
            countSpan.textContent = totalImages;

            // Update pagination controls
            this.updatePaginationControls();

            // Display current page
            this.displayCurrentPage();
        },

        // Display current page of images
        displayCurrentPage: function() {
            var grid = document.querySelector('#images-grid');
            if (!grid) return;

            var startIndex = (currentPage - 1) * pageSize;
            var endIndex = Math.min(startIndex + pageSize, filteredImages.length);
            var pageImages = filteredImages.slice(startIndex, endIndex);

            // Rebuild grid content for current page
            var gridContent = '';
            for (var i = 0; i < pageImages.length; i++) {
                var img = pageImages[i];
                var isCharacterPhoto = img.source && (img.source.indexOf('character.photos.background') !== -1 || img.source.indexOf('character.photos.foreground') !== -1);
                var checkboxHtml = isCharacterPhoto ? '' : '<input type="checkbox" class="image-checkbox" data-url="' + img.url + '" data-filename="' + img.message.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_' + (new Date(img.timestamp)).toISOString().split('T')[0] + '.jpg" style="position: absolute; top: 8px; right: 8px; width: 16px; height: 16px; cursor: pointer; z-index: 10;">';

                var imgHtml = '<img src="' + img.url + '" data-image-index="' + (startIndex + i) + '" style="width: 100%; height: clamp(120px, 25vw, 200px); object-fit: cover; border-radius: 6px; margin-bottom: clamp(4px, 1vw, 8px); cursor: pointer; border: 1px solid ' + colorScheme.border + ';" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'block\'">';
                var errorDiv = '<div style="display: none; background: ' + colorScheme.border + '; color: ' + colorScheme.textSecondary + '; text-align: center; padding: 20px; border-radius: 6px; margin-bottom: 8px;">Image failed to load</div>';
                var timestampDiv = '<div style="color: ' + colorScheme.textSecondary + '; font-size: clamp(9px, 2vw, 11px); margin-bottom: clamp(3px, 0.75vw, 6px);">' + (new Date(img.timestamp)).toLocaleString() + '</div>';
                var messageDiv = '<div style="color: ' + colorScheme.textPrimary + '; font-size: clamp(10px, 2.5vw, 12px); margin-bottom: clamp(3px, 0.75vw, 6px); line-height: 1.4; max-height: 40px; overflow: hidden; text-overflow: ellipsis;">' + (img.message || '') + '</div>';
                var modelDiv = img.model ? '<div style="color: ' + colorScheme.accent + '; font-size: clamp(9px, 2vw, 11px); margin-bottom: clamp(2px, 0.5vw, 4px); font-weight: 500;">' + img.model + '</div>' : '';

                gridContent += '<div style="background: ' + colorScheme.cardBackground + '; border-radius: 8px; padding: clamp(8px, 2vw, 12px); border: 1px solid ' + colorScheme.border + '; transition: transform 0.2s, box-shadow 0.2s; max-height: 300px; width: clamp(150px, calc(50% - 8px), 220px); flex-shrink: 0; position: relative;" onmouseover="this.style.transform=\'scale(1.02)\'; this.style.boxShadow=\'0 4px 12px ' + colorScheme.glowColor + '\'" onmouseout="this.style.transform=\'scale(1)\'; this.style.boxShadow=\'none\'">' +
                    checkboxHtml + imgHtml + errorDiv + timestampDiv + messageDiv + modelDiv +
                    '</div>';
            }

            grid.innerHTML = gridContent;

            // Add click handlers for images using event delegation
            var images = grid.querySelectorAll('img[data-image-index]');
            for (var j = 0; j < images.length; j++) {
                (function(img, index) {
                    img.addEventListener('click', function() {
                        var imageIndex = parseInt(img.getAttribute('data-image-index'), 10);
                        if (imageIndex >= 0 && imageIndex < filteredImages.length) {
                            ImageManager.showImageViewer(filteredImages[imageIndex], imageIndex);
                        }
                    });
                })(images[j], j);
            }
        },

        // Update pagination controls
        updatePaginationControls: function() {
            var pageInfo = document.querySelector('#page-info');
            var prevBtn = document.querySelector('#prev-page-btn');
            var nextBtn = document.querySelector('#next-page-btn');
            var pageSizeSelect = document.querySelector('#page-size-select');
            var pageJumpSelect = document.querySelector('#page-jump-select');

            if (!pageInfo || !prevBtn || !nextBtn) return;

            var totalPages = Math.ceil(totalImages / pageSize);
            var startIndex = (currentPage - 1) * pageSize + 1;
            var endIndex = Math.min(currentPage * pageSize, totalImages);

            // Update page info
            pageInfo.textContent = startIndex + '-' + endIndex + ' of ' + totalImages;

            // Update button states
            prevBtn.disabled = currentPage <= 1;
            nextBtn.disabled = currentPage >= totalPages;

            // Update page size select value
            if (pageSizeSelect) {
                pageSizeSelect.value = String(pageSize);
            }

            // Update page jump dropdown
            if (pageJumpSelect) {
                // Clear existing options
                pageJumpSelect.innerHTML = '';

                // Add options for each page
                for (var i = 1; i <= totalPages; i++) {
                    var option = document.createElement('option');
                    option.value = String(i);
                    option.textContent = 'Page ' + i;
                    if (i === currentPage) {
                        option.selected = true;
                    }
                    pageJumpSelect.appendChild(option);
                }
            }
        }
    };
    // Backward compatibility wrappers
    function closeImagePopup() { return ImageManager.closeImagePopup() }
    function showImageViewer(imageData, index) { return ImageManager.showImageViewer(imageData, index) }
    function renderComparisonView(enabled, batchImages) { return ImageManager.renderComparisonView(enabled, batchImages) }
    function findBatchImages(currentIndex, images) { return ImageManager.findBatchImages(currentIndex, images) }
    function closeImageViewer() { return ImageManager.closeImageViewer() }
    function filterImages(images, filterValue) { return ImageManager.filterImages(images, filterValue) }
    function displayCurrentPage() { return ImageManager.displayCurrentPage() }
    function updatePaginationControls() { return ImageManager.updatePaginationControls() }
    function showChatImages(messages, chatIndex, chatData) { return ImageManager.showChatImages(messages, chatIndex, chatData) }

    // ============================================================================
    // CONVERSATION RETRIEVAL
    // ============================================================================
    function retrieveConversationChunk(uuid, offset, collected, btn, chatIndex = null)
        {
        // Check cache on first chunk (offset 0)
        if (offset === 0) {
            const cachedMessages = chatCache.getChatMessages(uuid)
            if (cachedMessages && cachedMessages.length > 0) {
                // Use cached messages
                if (chatIndex !== null) {
                    const chatData = window.currentChats ? window.currentChats[chatIndex] : null
                    showChatImages(cachedMessages, chatIndex, chatData)
                } else {
                    exportConversation(cachedMessages)
                }

                btn.busy = false
                btn.innerText = chatIndex !== null ? 'Images' : 'Download'
                return // Don't make API call
            }
        }

        // Update progress if this is an export (not image viewing)
        // Check if we need to create a new progress indicator (none exists, or container was removed)
        var needsNewProgressIndicator = chatIndex === null && btn && (!btn.progressIndicator || !btn.progressIndicator.container || !btn.progressIndicator.container.parentNode);
        if (needsNewProgressIndicator) {
            // Clear any stale reference
            if (btn.progressIndicator && !btn.progressIndicator.container.parentNode) {
                btn.progressIndicator = null;
            }
            // Create a progress indicator element
            const progressContainer = document.createElement('div')
            progressContainer.className = 'holly-export-progress'
            progressContainer.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000010; background: ${colorScheme.cardBackground}; border: 1px solid ${colorScheme.border}; border-radius: 12px; padding: 20px; min-width: 300px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.5); cursor: move; user-select: none;`

            // Create header with title and minimize button
            const headerRow = document.createElement('div')
            headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; cursor: move;'

            const progressTitle = document.createElement('div')
            progressTitle.textContent = 'Exporting Chat...'
            progressTitle.style.cssText = `color: ${colorScheme.textPrimary}; font-weight: 600; font-size: 16px; flex: 1;`

            // Create minimize button
            const minimizeBtn = document.createElement('button')
            minimizeBtn.innerHTML = '−'
            minimizeBtn.style.cssText = `background: transparent; color: ${colorScheme.textPrimary}; border: none; border-radius: 4px; padding: 4px 8px; font-size: 18px; cursor: pointer; transition: all 0.2s; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; line-height: 1;`
            minimizeBtn.title = 'Minimize'
            minimizeBtn.addEventListener('mouseenter', function() {
                this.style.backgroundColor = colorScheme.hoverBackground
                this.style.color = colorScheme.hoverText
            })
            minimizeBtn.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent'
                this.style.color = colorScheme.textPrimary
            })

            headerRow.appendChild(progressTitle)
            headerRow.appendChild(minimizeBtn)

            const progressBarContainer = document.createElement('div')
            progressBarContainer.style.cssText = `width: 100%; height: 8px; background: ${colorScheme.border}; border-radius: 4px; overflow: hidden; margin-bottom: 8px;`

            const progressBar = document.createElement('div')
            progressBar.style.cssText = `height: 100%; background: ${colorScheme.gradient}; width: 0%; transition: width 0.3s ease; border-radius: 4px;`

            const progressText = document.createElement('div')
            progressText.className = 'holly-progress-text'
            progressText.style.cssText = `color: ${colorScheme.textSecondary}; font-size: 12px; text-align: center; margin-bottom: 12px;`
            progressText.textContent = 'Fetching messages...'

            // Create cancel button
            const cancelBtn = document.createElement('button')
            cancelBtn.textContent = 'Cancel'
            cancelBtn.style.cssText = `background: ${colorScheme.border}; color: ${colorScheme.textPrimary}; border: 1px solid ${colorScheme.border}; border-radius: 6px; padding: 8px 16px; font-size: 14px; cursor: pointer; transition: all 0.2s; width: 100%; margin-top: 8px;`
            cancelBtn.addEventListener('mouseenter', function() {
                this.style.backgroundColor = colorScheme.hoverBackground
                this.style.borderColor = colorScheme.hoverText
            })
            cancelBtn.addEventListener('mouseleave', function() {
                this.style.backgroundColor = colorScheme.border
                this.style.borderColor = colorScheme.border
            })

            // Create full content container (shown when not minimized)
            const fullContent = document.createElement('div')
            fullContent.className = 'holly-progress-full-content'
            fullContent.style.cssText = 'display: block;'
            fullContent.appendChild(progressBarContainer)
            fullContent.appendChild(progressText)
            fullContent.appendChild(cancelBtn)

            // Create minimized content container (shown when minimized)
            const minimizedContent = document.createElement('div')
            minimizedContent.className = 'holly-progress-minimized-content'
            minimizedContent.style.cssText = 'display: none; align-items: center; gap: 12px; cursor: move;'

            // Minimized progress bar
            const minimizedProgressBarContainer = document.createElement('div')
            minimizedProgressBarContainer.style.cssText = `flex: 1; height: 6px; background: ${colorScheme.border}; border-radius: 3px; overflow: hidden;`
            const minimizedProgressBar = document.createElement('div')
            minimizedProgressBar.style.cssText = `height: 100%; background: ${colorScheme.gradient}; width: 0%; transition: width 0.3s ease; border-radius: 3px;`
            minimizedProgressBarContainer.appendChild(minimizedProgressBar)

            // Minimized status text (shows "Exporting..." or "Complete")
            const minimizedStatusText = document.createElement('div')
            minimizedStatusText.className = 'holly-progress-minimized-status'
            minimizedStatusText.style.cssText = `color: ${colorScheme.textPrimary}; font-size: 12px; font-weight: 500; white-space: nowrap; min-width: 100px; text-align: center;`
            minimizedStatusText.textContent = 'Exporting...'

            // Minimized minimize button (to expand)
            const minimizedMinimizeBtn = document.createElement('button')
            minimizedMinimizeBtn.innerHTML = '+'
            minimizedMinimizeBtn.style.cssText = `background: transparent; color: ${colorScheme.textPrimary}; border: none; border-radius: 4px; padding: 4px 8px; font-size: 16px; cursor: pointer; transition: all 0.2s; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;`
            minimizedMinimizeBtn.title = 'Restore'
            minimizedMinimizeBtn.addEventListener('mouseenter', function() {
                this.style.backgroundColor = colorScheme.hoverBackground
                this.style.color = colorScheme.hoverText
            })
            minimizedMinimizeBtn.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent'
                this.style.color = colorScheme.textPrimary
            })

            // Minimized close button (✕)
            var minimizedCloseBtn = document.createElement('button')
            minimizedCloseBtn.innerHTML = '✕'
            minimizedCloseBtn.style.cssText = 'background: transparent; color: ' + colorScheme.textPrimary + '; border: none; border-radius: 4px; padding: 4px 8px; font-size: 16px; cursor: pointer; transition: all 0.2s; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0;'
            minimizedCloseBtn.title = 'Close'
            minimizedCloseBtn.addEventListener('mouseenter', function() {
                this.style.backgroundColor = colorScheme.hoverBackground
                this.style.color = colorScheme.hoverText
            })
            minimizedCloseBtn.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent'
                this.style.color = colorScheme.textPrimary
            })
            minimizedCloseBtn.addEventListener('click', function(e) {
                e.stopPropagation()
                // Use same logic as cancelBtn - check if it says "Close" or "Cancel"
                if (cancelBtn.textContent === 'Close') {
                    // Just close the modal
                    // Use current position if modal was dragged, otherwise center
                    var computedStyle = window.getComputedStyle(progressContainer)
                    var currentTransform = computedStyle.transform
                    var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)'
                    
                    progressContainer.style.opacity = '0'
                    if (hasTransform) {
                        progressContainer.style.transform = 'translate(-50%, -50%) scale(0.95)'
                    } else {
                        // Modal was dragged, use scale on current position
                        progressContainer.style.transform = 'scale(0.95)'
                    }
                    setTimeout(function() {
                        if (progressContainer && progressContainer.parentNode) {
                            progressContainer.parentNode.removeChild(progressContainer)
                        }
                        btn.progressIndicator = null
                    }, 300)
                    btn.busy = false
                    btn.innerText = 'Download'
                } else {
                    // Cancel export in progress
                    if (btn && btn.progressIndicator) {
                        btn.progressIndicator.cancelled = true
                        // Use current position if modal was dragged, otherwise center
                        var computedStyle = window.getComputedStyle(progressContainer)
                        var currentTransform = computedStyle.transform
                        var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)'
                        
                        progressContainer.style.opacity = '0'
                        if (hasTransform) {
                            progressContainer.style.transform = 'translate(-50%, -50%) scale(0.95)'
                        } else {
                            // Modal was dragged, use scale on current position
                            progressContainer.style.transform = 'scale(0.95)'
                        }
                        setTimeout(function() {
                            if (btn.progressIndicator && btn.progressIndicator.container.parentNode) {
                                btn.progressIndicator.container.parentNode.removeChild(btn.progressIndicator.container)
                            }
                            btn.progressIndicator = null
                        }, 300)
                        btn.busy = false
                        btn.innerText = 'Download'
                    }
                }
            })

            minimizedContent.appendChild(minimizedProgressBarContainer)
            minimizedContent.appendChild(minimizedStatusText)
            minimizedContent.appendChild(minimizedMinimizeBtn)
            minimizedContent.appendChild(minimizedCloseBtn)

            progressBarContainer.appendChild(progressBar)
            progressContainer.appendChild(headerRow)
            progressContainer.appendChild(fullContent)
            progressContainer.appendChild(minimizedContent)
            progressContainer.style.opacity = '0'
            document.body.appendChild(progressContainer)

            // Drag functionality
            var isDragging = false
            var dragOffsetX = 0
            var dragOffsetY = 0
            var currentX = 0
            var currentY = 0

            // Helper function to check if target is interactive
            function isInteractiveElement(target) {
                if (!target) return false
                var tagName = target.tagName
                // Check if it's a button or inside a button
                if (tagName === 'BUTTON' || (target.closest && target.closest('button'))) {
                    return true
                }
                // Check if it's an input or other interactive element
                if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
                    return true
                }
                // Check if it's inside an input/textarea/select
                if ((target.closest && (target.closest('input') || target.closest('textarea') || target.closest('select')))) {
                    return true
                }
                return false
            }

            function startDrag(e) {
                // Don't start drag if clicking on interactive elements
                if (isInteractiveElement(e.target)) {
                    return
                }
                
                // Check if we need to convert from transform-based to left/top positioning
                var computedStyle = window.getComputedStyle(progressContainer)
                var currentTransform = computedStyle.transform
                var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)'
                
                // Get current visual position first
                var rect = progressContainer.getBoundingClientRect()
                
                if (hasTransform) {
                    // Convert from transform-based positioning to left/top positioning
                    currentX = rect.left
                    currentY = rect.top
                    progressContainer.style.top = currentY + 'px'
                    progressContainer.style.left = currentX + 'px'
                    progressContainer.style.transform = 'none'
                    // Force a reflow to ensure the new position is applied
                    progressContainer.offsetHeight
                } else {
                    // Already using left/top positioning, use current visual position
                    currentX = rect.left
                    currentY = rect.top
                }
                
                // Calculate drag offset from where the mouse clicked relative to the container's current position
                dragOffsetX = e.clientX - currentX
                dragOffsetY = e.clientY - currentY
                
                isDragging = true
                progressContainer.style.cursor = 'grabbing'
                e.preventDefault()
            }

            function drag(e) {
                if (!isDragging) return
                e.preventDefault()
                currentX = e.clientX - dragOffsetX
                currentY = e.clientY - dragOffsetY

                // Constrain to viewport
                var maxX = window.innerWidth - progressContainer.offsetWidth
                var maxY = window.innerHeight - progressContainer.offsetHeight
                currentX = Math.max(0, Math.min(currentX, maxX))
                currentY = Math.max(0, Math.min(currentY, maxY))

                progressContainer.style.left = currentX + 'px'
                progressContainer.style.top = currentY + 'px'
                progressContainer.style.transform = 'none'
            }

            function stopDrag() {
                if (isDragging) {
                    isDragging = false
                    progressContainer.style.cursor = 'move'
                }
            }

            headerRow.addEventListener('mousedown', startDrag)
            // Also allow dragging from minimized content area (but not buttons)
            minimizedContent.addEventListener('mousedown', function(e) {
                if (!isInteractiveElement(e.target)) {
                    startDrag(e)
                }
            })
            // Allow dragging from anywhere in the progress container (padding areas)
            progressContainer.addEventListener('mousedown', function(e) {
                if (!isInteractiveElement(e.target)) {
                    startDrag(e)
                }
            })
            document.addEventListener('mousemove', drag)
            document.addEventListener('mouseup', stopDrag)

            // Minimize functionality
            var isMinimized = false
            function toggleMinimize() {
                isMinimized = !isMinimized
                if (isMinimized) {
                    // Switch to minimized view
                    fullContent.style.display = 'none'
                    minimizedContent.style.display = 'flex'
                    headerRow.style.display = 'none' // Hide header in minimized mode
                    progressContainer.style.minWidth = '250px'
                    progressContainer.style.width = 'auto'
                    progressContainer.style.padding = '6px 10px'
                    minimizeBtn.innerHTML = '+'
                    minimizeBtn.title = 'Restore'
                } else {
                    // Switch to full view
                    fullContent.style.display = 'block'
                    minimizedContent.style.display = 'none'
                    headerRow.style.display = 'flex' // Show header in full mode
                    progressContainer.style.minWidth = '300px'
                    progressContainer.style.width = 'auto'
                    progressContainer.style.padding = '20px'
                    minimizeBtn.innerHTML = '−'
                    minimizeBtn.title = 'Minimize'
                }
            }

            minimizeBtn.addEventListener('click', function(e) {
                e.stopPropagation()
                toggleMinimize()
            })

            minimizedMinimizeBtn.addEventListener('click', function(e) {
                e.stopPropagation()
                toggleMinimize()
            })

            cancelBtn.addEventListener('click', function() {
                // Check if button says "Close" (export complete) or "Cancel" (still exporting)
                if (this.textContent === 'Close') {
                    // Just close the modal, don't cancel export
                    // Use current position if modal was dragged, otherwise center
                    var computedStyle = window.getComputedStyle(progressContainer)
                    var currentTransform = computedStyle.transform
                    var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)'
                    
                    progressContainer.style.opacity = '0'
                    if (hasTransform) {
                        progressContainer.style.transform = 'translate(-50%, -50%) scale(0.95)'
                    } else {
                        // Modal was dragged, use scale on current position
                        progressContainer.style.transform = 'scale(0.95)'
                    }
                    setTimeout(function() {
                        if (progressContainer && progressContainer.parentNode) {
                            progressContainer.parentNode.removeChild(progressContainer)
                        }
                        btn.progressIndicator = null
                    }, 300)
                    // Reset button state
                    btn.busy = false
                    btn.innerText = 'Download'
                } else {
                    // Cancel export in progress
                    if (btn && btn.progressIndicator) {
                        btn.progressIndicator.cancelled = true
                        // Close progress indicator
                        // Use current position if modal was dragged, otherwise center
                        var computedStyle = window.getComputedStyle(btn.progressIndicator.container)
                        var currentTransform = computedStyle.transform
                        var hasTransform = currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)'
                        
                        btn.progressIndicator.container.style.opacity = '0'
                        if (hasTransform) {
                            btn.progressIndicator.container.style.transform = 'translate(-50%, -50%) scale(0.95)'
                        } else {
                            // Modal was dragged, use scale on current position
                            btn.progressIndicator.container.style.transform = 'scale(0.95)'
                        }
                        setTimeout(function() {
                            if (btn.progressIndicator && btn.progressIndicator.container.parentNode) {
                                btn.progressIndicator.container.parentNode.removeChild(btn.progressIndicator.container)
                            }
                            btn.progressIndicator = null
                        }, 300)
                        // Reset button state
                        btn.busy = false
                        btn.innerText = 'Download'
                    }
                }
            })

            // Fade in animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                    progressContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease'
                    progressContainer.style.opacity = '1'
                })
            })

            btn.progressIndicator = {
                container: progressContainer,
                bar: progressBar,
                text: progressText,
                startOffset: offset,
                cancelled: false,
                cancelBtn: cancelBtn,
                minimizedProgressBar: minimizedProgressBar,
                minimizedStatusText: minimizedStatusText
            }
        }

        // Update progress text
        if (btn && btn.progressIndicator && btn.progressIndicator.container && btn.progressIndicator.container.parentNode && chatIndex === null) {
            const chunkNumber = Math.floor(offset / QUERY_BATCH_SIZE) + 1
            btn.progressIndicator.text.textContent = `Fetching chunk ${chunkNumber}...`
            // Estimate progress (we don't know total, so show based on chunks)
            const estimatedProgress = Math.min(90, (chunkNumber * 10)) // Cap at 90% until we're done
            btn.progressIndicator.bar.style.width = `${estimatedProgress}%`
            // Update minimized progress bar
            if (btn.progressIndicator.minimizedProgressBar) {
                btn.progressIndicator.minimizedProgressBar.style.width = `${estimatedProgress}%`
            }
        }

        ajax('https://api.' + location.hostname + '/v1/chats/' + uuid + '/messages?limit=' + QUERY_BATCH_SIZE + '&offset=' + offset, false, function (r)
            {
            // Check if cancelled before processing response
            if (btn && btn.progressIndicator && btn.progressIndicator.cancelled) {
                return
            }

            r = JSON.parse(r)
            if (!r || r.error) {
                // Remove progress indicator on error
                if (btn && btn.progressIndicator) {
                    btn.progressIndicator.container.remove()
                    btn.progressIndicator = null
                }
                return
            }

            collected = collected.concat(r.messages)

            if (r.messages.length == QUERY_BATCH_SIZE) {
                // Check if cancelled before fetching next chunk
                if (btn && btn.progressIndicator && btn.progressIndicator.cancelled) {
                    return
                }

                // Update progress before next chunk
                if (btn && btn.progressIndicator && btn.progressIndicator.container && btn.progressIndicator.container.parentNode && chatIndex === null) {
                    const chunkNumber = Math.floor(offset / QUERY_BATCH_SIZE) + 1
                    btn.progressIndicator.text.textContent = `Fetched ${collected.length} messages... (chunk ${chunkNumber})`
                    // Update minimized status
                    if (btn.progressIndicator.minimizedStatusText) {
                        btn.progressIndicator.minimizedStatusText.textContent = `Fetching... ${collected.length} msgs`
                    }
                }
                retrieveConversationChunk(uuid, offset + QUERY_BATCH_SIZE, collected, btn, chatIndex)
            } else {
                // Check if cancelled before proceeding
                if (btn && btn.progressIndicator && btn.progressIndicator.cancelled) {
                    return
                }

                // All done - cache the messages
                chatCache.setChatMessages(uuid, collected)

                // All done - complete progress bar
                if (btn && btn.progressIndicator && btn.progressIndicator.container && btn.progressIndicator.container.parentNode && chatIndex === null) {
                    btn.progressIndicator.bar.style.width = '100%'
                    btn.progressIndicator.text.textContent = `Fetched ${collected.length} messages. Preparing export...`
                    // Update minimized progress bar
                    if (btn.progressIndicator.minimizedProgressBar) {
                        btn.progressIndicator.minimizedProgressBar.style.width = '100%'
                    }
                    // Update minimized status
                    if (btn.progressIndicator.minimizedStatusText) {
                        btn.progressIndicator.minimizedStatusText.textContent = 'Preparing export...'
                    }
                }

                // Small delay to show 100% before processing
                setTimeout(() => {
                    // Update progress for HTML format (or keep indicator for all formats)
                    if (btn && btn.progressIndicator && btn.progressIndicator.container && btn.progressIndicator.container.parentNode && chatIndex === null) {
                        const format = document.getElementById('holly_download_format')?.value || 'txt'
                        const isHTMLFormat = format === 'html'

                        if (isHTMLFormat) {
                            // Update progress for HTML format
                            btn.progressIndicator.text.textContent = `Processing ${collected.length} messages for HTML export...`
                            btn.progressIndicator.bar.style.width = '95%'
                            if (btn.progressIndicator.minimizedProgressBar) {
                                btn.progressIndicator.minimizedProgressBar.style.width = '95%'
                            }
                            if (btn.progressIndicator.minimizedStatusText) {
                                btn.progressIndicator.minimizedStatusText.textContent = 'Processing HTML...'
                            }
                        }
                    }

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
                        // Pass progress indicator for HTML format
                        exportConversation(collected, btn && btn.progressIndicator ? btn.progressIndicator : null)
                    }
                    }
                else
                    {
                    // No messages, but we can still show character/background photos if viewing images
                    if (chatIndex !== null) {
                        const chatData = window.currentChats ? window.currentChats[chatIndex] : null
                        showChatImages([], chatIndex, chatData)
                    } else {
                    alert('Nothing to download, this conversation is empty.')
                    }
                    }
                }, 300) // Small delay to show 100% before export
                }
            })
        }

    // ============================================================================
    // EXPORT MANAGER MODULE
    // ============================================================================
    var ExportManager = {
        // Export conversation to various formats (txt, jsonl-st, jsonl-openai, json, html)
        exportConversation: function(messages, progressIndicator) {
            if (typeof progressIndicator === 'undefined') {
                progressIndicator = null;
            }

            var formatSelect = document.getElementById('holly_download_format');
            var format = formatSelect ? formatSelect.value : 'txt'; // 'txt' | 'jsonl-st' | 'jsonl-openai' | 'json' | 'html'
            var character_name = '';
            var character_uuid = '';
            var out = [];

        // Sort messages by timestamp to ensure chronological order (oldest first)
            var sortedMessages = messages.slice();
            sortedMessages.sort(function(a, b) {
                var timeA = new Date(a.created_at).getTime();
                var timeB = new Date(b.created_at).getTime();
            return timeA - timeB;
        });

            for (var i = 0; i < sortedMessages.length; i++) {
                var msg = sortedMessages[i];
                var is_bot = (msg.message_source === 'bot');
                var name = is_bot ? (msg.character && msg.character.nickname ? msg.character.nickname : 'Character') : 'You';
                var text = msg.message || '';
                var ts = new Date(msg.created_at).getTime();

            if (is_bot) {
                if (!character_name) character_name = name;
                    if (!character_uuid) character_uuid = (msg.character && msg.character.uuid ? msg.character.uuid : '');
            }

            if (format === 'jsonl-st') {
                // Holly's ST flavor (kept for compatibility)
                    var variations = null;
                    var variation_idx = 0;
                if (msg.message_variations && Array.isArray(msg.message_variations)) {
                        variations = [];
                        for (var v = 0; v < msg.message_variations.length; v++) {
                            variations.push(msg.message_variations[v].message);
                        }
                        var idx = -1;
                        for (var vi = 0; vi < msg.message_variations.length; vi++) {
                            if (msg.message_variations[vi].uuid === msg.uuid) {
                                idx = vi;
                                break;
                            }
                        }
                    variation_idx = Math.max(0, idx);
                }
                out.push({
                        name: name,
                    is_user: !is_bot,
                    is_name: is_bot,
                    send_date: ts,
                    mes: text,
                    swipes: variations,
                    swipe_id: variation_idx
                });
            } else if (format === 'jsonl-openai') {
                // Portable, minimal OpenAI-style
                    var role = is_bot ? 'assistant' : 'user';
                    var rec = {
                        role: role,
                    content: text,
                    timestamp: ts
                };
                // Optional: include name for multi-assistant training sets
                if (is_bot && name) rec.name = name;

                // Hook for images/attachments if API supplies them (adjust field names)
                if (Array.isArray(msg.attachments) && msg.attachments.length) {
                        rec.images = [];
                        for (var ai = 0; ai < msg.attachments.length; ai++) {
                            var att = msg.attachments[ai];
                            if (att.url && /https?:\/\//.test(att.url)) {
                                rec.images.push(att.url);
                            }
                        }
                }
                out.push(rec);
            } else if (format === 'json') {
                // Raw-ish JSON passthrough with a small normalization
                    var variations = null;
                    if (msg.message_variations && Array.isArray(msg.message_variations)) {
                        variations = [];
                        for (var vi = 0; vi < msg.message_variations.length; vi++) {
                            variations.push({
                                uuid: msg.message_variations[vi].uuid,
                                text: msg.message_variations[vi].message
                            });
                        }
                    }
                out.push({
                    author: name,
                    role: is_bot ? 'assistant' : 'user',
                    timestamp: ts,
                        text: text,
                    // pass through known useful bits if present:
                    uuid: msg.uuid,
                        character_uuid: (msg.character && msg.character.uuid ? msg.character.uuid : null),
                        variations: variations
                });
            } else { // 'txt'
                out.push(name + '\n\n' + text);
            }
        }

        // Prepend character greeting if available
            var self = this;
            var finishAndSave = function(greeting) {
                var now = new Date();
                var baseName = Utils.sanitizeFileName('Chat with ' + (character_name || 'Character') + ' ' + now.toISOString().slice(0,10));

            if (format === 'jsonl-st') {
                    var header = { user_name: 'You', character_name: character_name || 'Character' };
                    var lines = [JSON.stringify(header)];

                    // Add greeting as first message if available
                    if (greeting) {
                        // Use timestamp from first message if available, otherwise use current time - 1 hour (to put it before)
                        var greetingTimestamp = out.length > 0
                            ? new Date(out[0].send_date).getTime() - 3600000 // 1 hour before first message
                            : Date.now() - 3600000;

                        lines.push(JSON.stringify({
                            name: character_name || 'Character',
                            is_user: false,
                            is_name: true,
                            send_date: greetingTimestamp,
                            mes: greeting,
                            swipes: null,
                            swipe_id: 0
                        }));
                    }

                    // Add all conversation messages
                    for (var oi = 0; oi < out.length; oi++) {
                        lines.push(JSON.stringify(out[oi]));
                    }
                    var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
                    Utils.download(URL.createObjectURL(blob), baseName + '.jsonl');
                    // Update progress indicator for completion
                    if (progressIndicator) {
                        progressIndicator.bar.style.width = '100%';
                        progressIndicator.text.textContent = 'Export complete!';
                        if (progressIndicator.minimizedProgressBar) {
                            progressIndicator.minimizedProgressBar.style.width = '100%';
                        }
                        if (progressIndicator.minimizedStatusText) {
                            progressIndicator.minimizedStatusText.textContent = 'Complete';
                        }
                        if (progressIndicator.cancelBtn) {
                            progressIndicator.cancelBtn.textContent = 'Close';
                        } else {
                            var fullContent = progressIndicator.container.querySelector('.holly-progress-full-content');
                            if (fullContent) {
                                var buttons = fullContent.querySelectorAll('button');
                                for (var b = 0; b < buttons.length; b++) {
                                    if (buttons[b].textContent.trim() === 'Cancel') {
                                        buttons[b].textContent = 'Close';
                                        break;
                                    }
                                }
                            }
                        }
                        // Auto-close if enabled (defaults to true if preference not set)
                        if (localStorage.getItem('hollyAutoCloseProgress') !== 'false') {
                            setTimeout(function() {
                                if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                    progressIndicator.container.style.opacity = '0';
                                    progressIndicator.container.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                    setTimeout(function() {
                                        if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                            progressIndicator.container.parentNode.removeChild(progressIndicator.container);
                                        }
                                    }, 300);
                                }
                            }, 2000);
                        }
                    }
            } else if (format === 'jsonl-openai') {
                    var lines = [];
                if (greeting) {
                    lines.push(JSON.stringify({ role:'assistant', name: character_name || 'Character', content: greeting, timestamp: Date.now() }));
                }
                    for (var oi = 0; oi < out.length; oi++) {
                        lines.push(JSON.stringify(out[oi]));
                    }
                    var blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' });
                    Utils.download(URL.createObjectURL(blob), baseName + '.jsonl');
                    // Update progress indicator for completion
                    if (progressIndicator) {
                        progressIndicator.bar.style.width = '100%';
                        progressIndicator.text.textContent = 'Export complete!';
                        if (progressIndicator.minimizedProgressBar) {
                            progressIndicator.minimizedProgressBar.style.width = '100%';
                        }
                        if (progressIndicator.minimizedStatusText) {
                            progressIndicator.minimizedStatusText.textContent = 'Complete';
                        }
                        if (progressIndicator.cancelBtn) {
                            progressIndicator.cancelBtn.textContent = 'Close';
                        } else {
                            var fullContent = progressIndicator.container.querySelector('.holly-progress-full-content');
                            if (fullContent) {
                                var buttons = fullContent.querySelectorAll('button');
                                for (var b = 0; b < buttons.length; b++) {
                                    if (buttons[b].textContent.trim() === 'Cancel') {
                                        buttons[b].textContent = 'Close';
                                        break;
                                    }
                                }
                            }
                        }
                        // Auto-close if enabled (defaults to true if preference not set)
                        if (localStorage.getItem('hollyAutoCloseProgress') !== 'false') {
                            setTimeout(function() {
                                if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                    progressIndicator.container.style.opacity = '0';
                                    progressIndicator.container.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                    setTimeout(function() {
                                        if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                            progressIndicator.container.parentNode.removeChild(progressIndicator.container);
                                        }
                                    }, 300);
                                }
                            }, 2000);
                        }
                    }
                } else if (format === 'json') {
                    var payload = {
                    source: location.href,
                    exported_at: new Date().toISOString(),
                    character_name: character_name || null,
                    greeting: greeting || null,
                    messages: out
                };
                    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                    Utils.download(URL.createObjectURL(blob), baseName + '.json');
                    // Update progress indicator for completion
                    if (progressIndicator) {
                        progressIndicator.bar.style.width = '100%';
                        progressIndicator.text.textContent = 'Export complete!';
                        if (progressIndicator.minimizedProgressBar) {
                            progressIndicator.minimizedProgressBar.style.width = '100%';
                        }
                        if (progressIndicator.minimizedStatusText) {
                            progressIndicator.minimizedStatusText.textContent = 'Complete';
                        }
                        if (progressIndicator.cancelBtn) {
                            progressIndicator.cancelBtn.textContent = 'Close';
                        } else {
                            var fullContent = progressIndicator.container.querySelector('.holly-progress-full-content');
                            if (fullContent) {
                                var buttons = fullContent.querySelectorAll('button');
                                for (var b = 0; b < buttons.length; b++) {
                                    if (buttons[b].textContent.trim() === 'Cancel') {
                                        buttons[b].textContent = 'Close';
                                        break;
                                    }
                                }
                            }
                        }
                        // Auto-close if enabled (defaults to true if preference not set)
                        if (localStorage.getItem('hollyAutoCloseProgress') !== 'false') {
                            setTimeout(function() {
                                if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                    progressIndicator.container.style.opacity = '0';
                                    progressIndicator.container.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                    setTimeout(function() {
                                        if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                            progressIndicator.container.parentNode.removeChild(progressIndicator.container);
                                        }
                                    }, 300);
                                }
                            }, 2000);
                        }
                    }
                } else if (format === 'html') {
                    // HTML export with embedded images
                    var htmlContent = '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'    <meta charset="UTF-8">\n' +
'    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'    <title>Chat with ' + Utils.sanitizeFileName(character_name || 'Character') + '</title>\n' +
'    <style>\n' +
'        * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'        body {\n' +
'            font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;\n' +
'            background: #151820;\n' +
'            color: #ffffff;\n' +
'            line-height: 1.6;\n' +
'            padding: 20px;\n' +
'            max-width: 1200px;\n' +
'            margin: 0 auto;\n' +
'        }\n' +
'        .header {\n' +
'            background: #25282c;\n' +
'            padding: 20px;\n' +
'            border-radius: 12px;\n' +
'            margin-bottom: 20px;\n' +
'            border: 1px solid #303439;\n' +
'        }\n' +
'        .header h1 {\n' +
'            font-size: 24px;\n' +
'            margin-bottom: 8px;\n' +
'            color: ' + (isMoescape ? '#E4F063' : '#f597E8') + ';\n' +
'        }\n' +
'        .header .meta {\n' +
'            color: #999;\n' +
'            font-size: 14px;\n' +
'        }\n' +
'        .message {\n' +
'            background: #25282c;\n' +
'            padding: 16px;\n' +
'            border-radius: 8px;\n' +
'            margin-bottom: 16px;\n' +
'            border-left: 4px solid ' + (isMoescape ? '#E4F063' : '#f597E8') + ';\n' +
'        }\n' +
'        .message.user {\n' +
'            border-left-color: #4b5563;\n' +
'        }\n' +
'        .message-header {\n' +
'            font-weight: 600;\n' +
'            margin-bottom: 8px;\n' +
'            color: ' + (isMoescape ? '#E4F063' : '#f597E8') + ';\n' +
'        }\n' +
'        .message.user .message-header {\n' +
'            color: #ffffff;\n' +
'        }\n' +
'        .message-content {\n' +
'            color: #e0e0e0;\n' +
'            white-space: pre-wrap;\n' +
'            word-wrap: break-word;\n' +
'        }\n' +
'        .message-timestamp {\n' +
'            color: #999;\n' +
'            font-size: 12px;\n' +
'            margin-top: 8px;\n' +
'        }\n' +
'        .message-images {\n' +
'            margin-top: 12px;\n' +
'            display: flex;\n' +
'            flex-wrap: wrap;\n' +
'            gap: 12px;\n' +
'        }\n' +
'        .message-images img {\n' +
'            max-width: 100%;\n' +
'            max-height: 400px;\n' +
'            border-radius: 8px;\n' +
'            border: 1px solid #303439;\n' +
'            cursor: pointer;\n' +
'        }\n' +
'        .greeting {\n' +
'            background: #25282c;\n' +
'            padding: 16px;\n' +
'            border-radius: 8px;\n' +
'            margin-bottom: 20px;\n' +
'            border: 1px solid #303439;\n' +
'            font-style: italic;\n' +
'            color: #e0e0e0;\n' +
'        }\n' +
'        @media (max-width: 768px) {\n' +
'            body { padding: 12px; }\n' +
'            .message-images img { max-height: 300px; }\n' +
'        }\n' +
'    </style>\n' +
'</head>\n' +
'<body>\n' +
'    <div class="header">\n' +
'        <h1>Chat with ' + Utils.sanitizeFileName(character_name || 'Character') + '</h1>\n' +
'        <div class="meta">Exported on ' + new Date().toLocaleString() + ' from ' + location.hostname + '</div>\n' +
'    </div>';

                    if (greeting) {
                        var greetingEscaped = greeting.replace(/\n/g, '<br>');
                        htmlContent += '\n    <div class="greeting">\n        <strong>' + Utils.sanitizeFileName(character_name || 'Character') + ':</strong><br>\n        ' + greetingEscaped + '\n    </div>';
                    }

                    // Process messages and embed images
                    var processMessagesForHTML = function() {
                        var totalMessages = sortedMessages.length;
                        for (var i = 0; i < sortedMessages.length; i++) {
                            var msg = sortedMessages[i];
                            var is_bot = (msg.message_source === 'bot');
                            var name = is_bot ? (msg.character && msg.character.nickname ? msg.character.nickname : character_name || 'Character') : 'You';
                            var text = msg.message || '';
                            var ts = new Date(msg.created_at).toLocaleString();
                            var msgClass = is_bot ? 'assistant' : 'user';

                            // Check if this is an image command
                            var isImageCommand = text && (
                                text.indexOf('/image you') !== -1 ||
                                text.indexOf('/image face') !== -1 ||
                                text.indexOf('/image last') !== -1 ||
                                text.indexOf('/image raw_last') !== -1 ||
                                text.trim().indexOf('/image') === 0
                            );
                            var hasImages = msg.text_to_image && msg.text_to_image.output_image_url;

                            // Hide text content for bot messages that are image responses (command echo)
                            var shouldShowText = !(is_bot && hasImages && isImageCommand);

                            // Only show images for bot messages (generated images come from bot responses)
                            // User command messages should not display images
                            var shouldShowImages = hasImages && is_bot;

                            // Update progress every 10 messages or at the end
                            if (progressIndicator && (i % 10 === 0 || i === totalMessages - 1)) {
                                var progress = Math.floor(((i + 1) / totalMessages) * 5) + 95; // 95-100%
                                progressIndicator.bar.style.width = progress + '%';
                                progressIndicator.text.textContent = 'Processing message ' + (i + 1) + ' of ' + totalMessages + '...';
                            }

                            htmlContent += '\n    <div class="message ' + msgClass + '">\n        <div class="message-header">' + Utils.escapeHtml(name) + '</div>';

                            // Only show text content if it should be shown
                            if (shouldShowText && text) {
                                htmlContent += '\n        <div class="message-content">' + Utils.escapeHtml(text) + '</div>';
                            }

                            // Add images if present (only for bot responses, not user command messages)
                            if (shouldShowImages) {
                                htmlContent += '\n        <div class="message-images">';

                                // Function to check if URL is a thumbnail
                                var isThumbnail = function(url) {
                                    if (!url) return false;
                                    return url.indexOf('-resized') !== -1 ||
                                           url.indexOf('width%3D256') !== -1 ||
                                           url.indexOf('width=256') !== -1 ||
                                           url.indexOf('width%3D512') !== -1 ||
                                           url.indexOf('width=512') !== -1 ||
                                           url.indexOf('thumbnail') !== -1 ||
                                           url.indexOf('thumb') !== -1 ||
                                           url.indexOf('small') !== -1 ||
                                           url.indexOf('preview') !== -1;
                                };

                                // Try to get all full-size images from this message
                                var imageUrls = [];
                                var seenUrls = {};

                                // Add primary output_image_url if it's full-size
                                if (msg.text_to_image.output_image_url && !isThumbnail(msg.text_to_image.output_image_url)) {
                                    imageUrls.push(msg.text_to_image.output_image_url);
                                    seenUrls[msg.text_to_image.output_image_url.split('?')[0]] = true; // Normalize for comparison
                                }

                                // Check for additional images in arrays (prefer orig_url for full-size)
                                var possibleImageFields = ['output_images', 'images', 'generated_images'];
                                for (var fieldIdx = 0; fieldIdx < possibleImageFields.length; fieldIdx++) {
                                    var field = possibleImageFields[fieldIdx];
                                    if (msg.text_to_image[field] && Array.isArray(msg.text_to_image[field])) {
                                        for (var imgIdx = 0; imgIdx < msg.text_to_image[field].length; imgIdx++) {
                                            var img = msg.text_to_image[field][imgIdx];
                                            var fullSizeUrl = null;

                                            if (typeof img === 'string' && img.indexOf('http') === 0) {
                                                // String URL - use it if it's not a thumbnail
                                                if (!isThumbnail(img)) {
                                                    fullSizeUrl = img;
                                                }
                                            } else if (img && typeof img === 'object') {
                                                // Object - prefer orig_url (full-size), then check other fields if orig_url doesn't exist
                                                // Priority: orig_url > url > src > image_url > full_url > original_url
                                                if (img.orig_url && !isThumbnail(img.orig_url)) {
                                                    fullSizeUrl = img.orig_url;
                                                } else {
                                                    // Try other fields, but skip if they're thumbnails
                                                    var candidates = [];
                                                    if (img.url) candidates.push(img.url);
                                                    if (img.src) candidates.push(img.src);
                                                    if (img.image_url) candidates.push(img.image_url);
                                                    if (img.full_url) candidates.push(img.full_url);
                                                    if (img.original_url) candidates.push(img.original_url);
                                                    for (var cIdx = 0; cIdx < candidates.length; cIdx++) {
                                                        var candidate = candidates[cIdx];
                                                        if (candidate && candidate.indexOf('http') === 0 && !isThumbnail(candidate)) {
                                                            fullSizeUrl = candidate;
                                                            break;
                                                        }
                                                    }
                                                }
                                            }

                                            // Add full-size URL if found and not already added
                                            if (fullSizeUrl && fullSizeUrl.indexOf('http') === 0) {
                                                var normalized = fullSizeUrl.split('?')[0];
                                                if (!seenUrls[normalized]) {
                                                    imageUrls.push(fullSizeUrl);
                                                    seenUrls[normalized] = true;
                                                }
                                            }
                                        }
                                    }
                                }

                                // Add image tags (using URLs - base64 embedding would make file huge)
                                for (var imgUrlIdx = 0; imgUrlIdx < imageUrls.length; imgUrlIdx++) {
                                    var imgUrl = imageUrls[imgUrlIdx];
                                    htmlContent += '\n            <img src="' + Utils.escapeHtml(imgUrl) + '" alt="Generated image" loading="lazy" onclick="window.open(this.src, \'_blank\')">';
                                }

                                htmlContent += '\n        </div>';
                            }

                            htmlContent += '\n        <div class="message-timestamp">' + Utils.escapeHtml(ts) + '</div>\n    </div>';
                        }

                        htmlContent += '\n</body>\n</html>';

                        // Complete progress
                        if (progressIndicator) {
                            progressIndicator.bar.style.width = '100%';
                            progressIndicator.text.textContent = 'Export complete!';
                            // Update minimized progress bar
                            if (progressIndicator.minimizedProgressBar) {
                                progressIndicator.minimizedProgressBar.style.width = '100%';
                            }
                            // Update minimized status
                            if (progressIndicator.minimizedStatusText) {
                                progressIndicator.minimizedStatusText.textContent = 'Complete';
                            }
                            // Change cancel button to "Close"
                            if (progressIndicator.cancelBtn) {
                                progressIndicator.cancelBtn.textContent = 'Close';
                            } else {
                                // Fallback: try to find cancel button in DOM
                                var fullContent = progressIndicator.container.querySelector('.holly-progress-full-content');
                                if (fullContent) {
                                    var buttons = fullContent.querySelectorAll('button');
                                    for (var b = 0; b < buttons.length; b++) {
                                        if (buttons[b].textContent.trim() === 'Cancel') {
                                            buttons[b].textContent = 'Close';
                                            break;
                                        }
                                    }
                                }
                            }

                            // Auto-close if enabled (defaults to true if preference not set)
                            if (localStorage.getItem('hollyAutoCloseProgress') !== 'false') {
                                setTimeout(function() {
                                    if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                        progressIndicator.container.style.opacity = '0';
                                        progressIndicator.container.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                        setTimeout(function() {
                                            if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                                progressIndicator.container.parentNode.removeChild(progressIndicator.container);
                                            }
                                            // Clear the progress indicator reference (need to find the button that owns it)
                                            // The progressIndicator is stored on btn.progressIndicator, but we don't have btn reference here
                                            // We'll clear it when the container is removed - the next export will create a new one
                                        }, 300);
                                    }
                                }, 2000); // 2 second delay after completion
                            }
                        }

                        var blob = new Blob([htmlContent], { type: 'text/html' });
                        Utils.download(URL.createObjectURL(blob), baseName + '.html');
                    };

                    processMessagesForHTML();
            } else { // txt
                    var pieces = [];
                if (greeting) pieces.push((character_name || 'Character') + '\n\n' + greeting);
                    for (var oi = 0; oi < out.length; oi++) {
                        pieces.push(out[oi]);
                    }
                    var blob = new Blob([pieces.join('\n\n\n')], { type: 'text/plain' });
                    Utils.download(URL.createObjectURL(blob), baseName + '.txt');
                    // Update progress indicator for completion
                    if (progressIndicator) {
                        progressIndicator.bar.style.width = '100%';
                        progressIndicator.text.textContent = 'Export complete!';
                        if (progressIndicator.minimizedProgressBar) {
                            progressIndicator.minimizedProgressBar.style.width = '100%';
                        }
                        if (progressIndicator.minimizedStatusText) {
                            progressIndicator.minimizedStatusText.textContent = 'Complete';
                        }
                        if (progressIndicator.cancelBtn) {
                            progressIndicator.cancelBtn.textContent = 'Close';
                        } else {
                            var fullContent = progressIndicator.container.querySelector('.holly-progress-full-content');
                            if (fullContent) {
                                var buttons = fullContent.querySelectorAll('button');
                                for (var b = 0; b < buttons.length; b++) {
                                    if (buttons[b].textContent.trim() === 'Cancel') {
                                        buttons[b].textContent = 'Close';
                                        break;
                                    }
                                }
                            }
                        }
                        // Auto-close if enabled (defaults to true if preference not set)
                        if (localStorage.getItem('hollyAutoCloseProgress') !== 'false') {
                            setTimeout(function() {
                                if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                    progressIndicator.container.style.opacity = '0';
                                    progressIndicator.container.style.transform = 'translate(-50%, -50%) scale(0.95)';
                                    setTimeout(function() {
                                        if (progressIndicator && progressIndicator.container && progressIndicator.container.parentNode) {
                                            progressIndicator.container.parentNode.removeChild(progressIndicator.container);
                                        }
                                    }, 300);
                                }
                            }, 2000);
                        }
                    }
            }
        };

        // Fetch greeting once (as original), then emit
            API.ajax('https://api.' + location.hostname + '/v1/characters/' + character_uuid, false, function (r) {
                var greeting = null;
            try {
                    var j = r ? JSON.parse(r) : null;
                if (j && !j.error) {
                    // maintain compatibility with existing keys
                    greeting = j.char_greeting || j.greeting || null;
                    if (!character_name) character_name = j.char_name || character_name;
                }
                } catch (e) {}
            finishAndSave(greeting);
        });
    }
    };

    // Backward compatibility wrapper
    function exportConversation(messages, progressIndicator) {
        return ExportManager.exportConversation(messages, progressIndicator);
    }

    // ============================================================================
    // NETWORK UTILITIES
    // ============================================================================
    var API = {
        // Main AJAX function with retry logic
        ajax: function(url, post, callback, csrf, tries) {
            if (typeof tries === 'undefined') {
                tries = 0;
            }
        try {
            var request = new XMLHttpRequest();
            request.onreadystatechange = function () {
            if (request.readyState !== 4) return;

            var okay = (request.status >= 200 && request.status < 300);
            var notFound = (request.status === 404);

            if (okay || notFound) {
                if (callback) callback(request.responseText, request.getResponseHeader('X-Csrf-Token'), request.status);
                return;
            }

            // Retry on 429/5xx with exponential backoff
            if ((request.status === 429 || (request.status >= 500 && request.status < 600)) && tries < 6) {
                var backoff = Math.min(2000 * Math.pow(2, tries), 15000); // cap at 15s
                console.warn('AJAX retry', request.status, '→ waiting', backoff, 'ms for', url);
                setTimeout(function() {
                    API.ajax(url, post, callback, csrf, tries + 1);
                }, backoff);
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
            var backoff = Math.min(2000 * Math.pow(2, tries), 15000);
            setTimeout(function() {
                API.ajax(url, post, callback, csrf, tries + 1);
            }, backoff);
            }
        }
        }
    }

    // Backward compatibility
    function ajax(url, post, callback, csrf, tries) {
        return API.ajax(url, post, callback, csrf, tries)
    }

    // Note: download function is now in Utils module above

})();
