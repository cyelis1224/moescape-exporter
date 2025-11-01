# Change Log - Tavern Chat Downloader

## Version 2.2.4 - Character Icons Refactor & Visual Polish

### New Features
- **Horizontally Scrollable Character Icons**: Complete redesign of character icon display
  - Replaced grid layout with smooth horizontal scrolling list
  - Fixed width container showing 1.25 character icons to hint at scrollable content
  - Subtle fade effects on left and right edges using gradient overlays
  - First icon includes 24px left padding for perfect alignment with single-character chats
  - Scrollbar automatically hidden for single-character chats (no scrolling needed)
  - Scrollbar matches export list styling for visual consistency (8px height, 4px border-radius)

### UI/UX Enhancements
- **Improved Visual Hierarchy**: Character icons no longer take up excessive vertical space
  - Consistent 56px icon size across all devices and character counts
  - Better space utilization with horizontal scrolling
  - Glow effects fully visible with proper padding and overflow handling
  - Fade gradients blend seamlessly with card background
- **Mobile Filter Button Improvements**: Enhanced touch interface for filter controls
  - Filter buttons (Recent Chats, Bookmarks) properly aligned on mobile
  - Larger icons (24x24px) for better visibility and touch targets
  - Consistent 44x44px button sizes for optimal touch interaction
  - Proper flexbox alignment ensures buttons sit on same baseline

### Technical Improvements
- **Overflow Management**: Proper handling of glow effects and fade gradients
  - Container overflow adjusted to allow glow effects to display fully
  - Padding calculations account for box-shadow extensions (12px blur + 4px offset)
  - Fade pseudo-elements positioned to stay within chat entry boundaries
  - Scrollbar styling unified across all scrollable containers

### User Experience
- **Cleaner Interface**: Character icons take up less space while remaining accessible
- **Better Visual Feedback**: Glow effects visible without clipping
- **Consistent Design**: Scrollbars match throughout the application
- **Improved Mobile Experience**: Better button alignment and sizing for touch interfaces

-----

## Version 2.2.0 - Bookmark System & Advanced Organization

### New Features
- **Bookmark System**: Complete bookmarking functionality for favorite chats
  - Bookmark icon button next to "Recent Only" filter for quick access
  - Individual bookmark button on each chat entry (after Images button)
  - Bookmarked chats persist across sessions using localStorage
  - Bookmark filter button shows only bookmarked chats when active
  - Dynamic modal title updates: "All Chats", "Recent Chats", or "Bookmarks"
  - Bookmark count displayed in modal title when filter is active
  - Visual indicators: primary color when unbookmarked, secondary color when bookmarked
- **Recent Chats Filter**: Quick access to recently active conversations
  - Extracts recent chat UUIDs from DOM (matches site's recent chats order)
  - Preserves original DOM order when filtering
  - Mutually exclusive with bookmark filter (activating one deactivates the other)
  - Sort dropdown automatically hidden when Recent Chats filter is active
- **Image Count Sorting**: Sort chats by number of generated images
  - New sort option: "Image Count (Most/Least)"
  - Lazy loading: image counts fetched only when this sort is selected
  - Batch fetching with rate limiting for API efficiency
  - Progress feedback during count fetching

### UI/UX Enhancements
- **Dynamic Modal Titles**: Context-aware titles with counts
  - "All Chats (N)" - shows total when no filters active
  - "Recent Chats (N)" - shows count when recent filter active
  - "Bookmarks (N)" - shows bookmark count when bookmark filter active
  - "Your chats with <Character name> (N)" - when opened from chat page
- **Mutually Exclusive Filters**: Bookmark and Recent filters cannot be active simultaneously
  - Activating one automatically deactivates the other
  - Clear visual feedback with button state changes
  - Sort dropdown shows/hides appropriately based on active filter

### Technical Improvements
- **BookmarkManager Module**: Dedicated module for bookmark management
  - `getBookmarks()`: Retrieves bookmarked UUIDs from localStorage
  - `isBookmarked(uuid)`: Checks bookmark status
  - `toggleBookmark(uuid)`: Adds/removes bookmarks
  - `getBookmarkCount()`: Returns total bookmark count
- **Enhanced Chat List Filtering**: Improved filter logic and state management
  - Bookmark filtering integrated into `recomputeList()` function
  - Recent chats filter preserves DOM order via indexOf sorting
  - Sort logic respects active filter states
  - Title updates dynamically based on active filters

### User Experience
- **Better Organization**: Easily find and access favorite chats
- **Quick Access**: Recent chats filter for fast navigation to active conversations
- **Persistent Preferences**: Bookmarks saved across browser sessions
- **Smart Sorting**: Find image-heavy chats quickly with image count sorting
- **Clear Visual Feedback**: Bookmarked chats clearly distinguished with color changes

-----

## Version 2.1.0 - Code Refactoring & Modularization

### Major Refactoring
- **Modular Code Organization**: Complete restructuring into logical modules
  - **ImageManager Module**: All image-related functionality consolidated
    - `closeImagePopup()`, `showImageViewer()`, `renderComparisonView()`
    - `findBatchImages()`, `closeImageViewer()`, `filterImages()`
    - `displayCurrentPage()`, `updatePaginationControls()`, `showChatImages()`
  - **ChatManager Module**: Chat data retrieval and management
    - `retrieveChatsChunk()`: Paginated chat list fetching with caching
    - `fetchImageCountForChat()`: Lightweight image count retrieval
    - `fetchImageCountRecursive()`: Recursive helper for nested fetching
    - `extractRecentChatUuids()`: DOM-based recent chats extraction
    - `fetchImageCountsForMissingChats()`: Batch fetching with rate limiting
  - **ExportManager Module**: Export functionality isolated
    - `exportConversation()`: Handles all export formats (TXT, JSONL-ST, JSONL-OpenAI, JSON, HTML)
    - Image embedding logic for HTML exports
    - Character greeting handling for SillyTavern format
  - **UIComponents Module**: UI creation functions grouped
    - `triggerExporter()`: Opens chat exporter modal with context
    - `addExporterToChatMenu()`: Dynamic menu item insertion

### Technical Improvements
- **ES5 Compatibility**: Full conversion for broader browser support
  - All `let`/`const` converted to `var`
  - Arrow functions converted to traditional `function` expressions
  - Template literals replaced with string concatenation
  - `.includes()` replaced with `.indexOf() !== -1`
- **Backward Compatibility**: Wrapper functions maintained for existing code
  - All moved functions have global wrappers for compatibility
  - No breaking changes to existing functionality
- **Improved File Structure**: Clear organization with detailed header comments
  - 13 logical sections with clear boundaries
  - Easy navigation and maintenance
  - Better code discoverability

### Code Quality
- **Better Maintainability**: Related functionality grouped logically
- **Reduced Duplication**: Common patterns extracted to modules
- **Easier Testing**: Isolated modules can be tested independently
- **Enhanced Readability**: Clear module boundaries and responsibilities

-----

## Version 2.0.0 - Advanced Image Metadata & Generation Details

### New Features
- **Expandable Metadata Section**: Image viewer now includes detailed generation information
  - Click the expand arrow (▼) at the bottom of metadata to reveal full details
  - Full prompt display with word wrapping for long prompts
  - Negative prompt shown in distinct styling
  - Complete generation settings in organized grid layout:
    - Image size (width × height)
    - Sampling steps and method
    - CFG Scale
    - Seed value
    - Batch size
  - Scrollable section (max 300px height) for lengthy prompts
  - Smooth rotation animation when expanding/collapsing (▼ → ▲)
- **Persistent Metadata Preferences**: Toggle state saved to localStorage
  - Your metadata visibility choice is remembered across all sessions
  - Applies to both the main toggle and expanded details
  - Set it once, never toggle again unless you want to change it

### UI/UX Enhancements
- **Pill-Style Metadata Toggle**: Modern slider control in bottom-left of image viewer
  - Visual state indicators: gradient when ON, dark when OFF
  - Label color changes: secondary (active) when ON, primary (prominent) when OFF
  - Smooth toggle animations and transitions
- **Expandable Details Toggle**: Bordered button with clear hover states
  - Larger clickable area with padding for better usability
  - Border color matches theme's textSecondary color
  - Pointer cursor on hover for clear interactivity
  - Triangle icon rotates 180° when expanded
- **Batch Image Support**: All images in a generation batch now include full metadata
  - Previously only the first image in a batch (2-4 images) showed metadata
  - Now all batch images display the complete prompt and settings
  - Consistent experience across all generated images

### Technical Improvements
- **Metadata Propagation**: Full `text_to_image` object now passed to all image variants
  - Applied to images found in nested arrays and objects
  - Covers all discovery methods (string URLs, array items, nested object values)
  - Ensures complete metadata availability regardless of image source
- **Proper Event Handling**: `pointer-events: none` on child elements
  - Prevents event interference between parent and child elements
  - Ensures cursor changes work reliably
  - Clean event propagation for better interaction handling
- **localStorage Integration**: Cross-session state persistence
  - Metadata visibility preference stored as `hollyMetadataVisible`
  - Checked on viewer initialization for consistent state
  - No additional API permissions required

### User Experience
- **Discover Generation Details**: See exactly how any image was created
  - Perfect for recreating successful generations
  - Learn from effective prompts and settings
  - Understand the technical parameters behind your favorite images
- **Reduced Repetition**: Metadata toggle remembers your preference
  - One-time setup for your preferred viewing mode
  - Consistent experience across all image viewing sessions
  - No need to repeatedly show/hide metadata
- **Complete Information**: Every generated image now has full context
  - Batch images no longer missing their generation details
  - Comprehensive metadata for all AI-generated content
  - Easy comparison between images in the same batch

-----

## Version 1.2.9 - Chat Settings Integration & Export UX

### New Features
- Added “Export Chat” to the in‑chat settings menu, positioned just under “All Chats”
- Context‑aware exporter: when opened from a chat, the list filters to chats with the same character(s)
- Title becomes “Your chats with <Character name>” when opened in‑chat; otherwise remains “Your Chats”
- Search bar for chats and characters with instant filtering (works with sort)

### UI/UX Enhancements
- Menu item hover highlight to match native items; download icon sized 24×24 in the menu (and 16–20px in the header per layout)
- Search bar styled to match site theme (Yodayo/Moescape)
  - Focus state highlights border and shows a subtle glow using theme colors
  - Responsive width on mobile to prevent overflow beyond modal boundaries
- Sort dropdown in the export modal: Date (Newest/Oldest), Name (A–Z/Z–A), Character (A–Z)
- Moved "Download as …" format selector to a footer row for a cleaner header
- Truncated modal title with ellipsis and added padding/max‑width so it never sits under the close button
- Image viewer metadata toggle: pill-style slider with dynamic label colors
  - Positioned in bottom-left corner with "Metadata" label
  - Label color changes based on state (secondary when ON, primary when OFF)
  - Smooth animations and visual feedback for toggle state

### Technical Improvements
- Correct character/background image association after filtering and sorting: renderer now keeps `window.currentChats` in sync
- Clearing chat‑specific filter when exporter opens from the global header to show all chats
- More robust DOM insertion for the settings menu item to avoid `insertBefore` errors
- Image viewer keyboard event handling: uses capture phase and proper cleanup to prevent event stacking
- Navigation throttling: added lock mechanism to prevent arrow keys from skipping multiple images

### Bug Fixes
- Fixed image viewer ESC key closing both viewer and popup modal when viewer is open
- Fixed arrow key navigation jumping multiple images instead of one at a time (was compounding after reopening viewer)
- Fixed image viewer event handlers stacking on repeated openings, causing navigation issues

### User Experience
- Faster access to export while chatting
- Clearer, personalized modal titles
- Easier finding and sorting of chats (search + sort)
- Proper modal hierarchy: ESC closes only the topmost modal (viewer > popup > export modal)

-----

## Version 1.2.8 - Image Viewer & Navigation Enhancements

### New Features
- **Image Viewer Modal**: Professional full-screen image viewing experience
  - Click any image in the popup to open in a beautiful modal viewer
  - Navigation arrows (← →) for easy browsing through all images
  - Blur backdrop with fade animations for immersive viewing
  - Circular close button (X) with hover effects in top-right corner
  - Keyboard shortcuts: Arrow keys to navigate, ESC to close
  - Image metadata displayed below (timestamp, model, message)
  - Smooth fade transitions when switching between images
- **Smart Page Tracking**: Automatic page switching in background when navigating images
  - When viewing images in the viewer, the image popup automatically switches pages
  - Navigate to image 21 and the popup moves to page 2
  - Seamless experience when browsing through large image collections
- **Clickable Chat Names**: Chat names in the export modal are now clickable links
  - Click any chat name to open that chat in a new tab
  - Direct access to specific conversations without closing the modal
  - Preserves modal state while navigating to chats
- **Intelligent Download Handling**: CORS-aware download button in image viewer
  - Automatically detects CORS-protected images (character photos, backgrounds)
  - Opens CORS-protected images in new tab for manual download
  - Direct downloads for generated images that aren't CORS-protected
  - Graceful fallback to new tab if download fails

### UI/UX Enhancements
- **Fixed Character Icon Sizes**: Consistent 80px icon sizes regardless of character count
  - Desktop: All character icons maintain 80px size in single row
  - Mobile: Icons shrink to 56px and wrap when there are 2+ characters
  - Maximum 2 rows on mobile for better space utilization
  - Professional, consistent appearance across all chat entries
- **Download Button Styling**: Matches export modal button style
  - Gradient background with site-appropriate accent colors
  - Hover effects that match the site's color scheme
  - Positioned in bottom-right corner for easy access
  - Clear visual hierarchy with proper z-index management

### Technical Improvements
- **Enhanced Image Navigation**: State management for smooth page transitions
  - Tracks current image index across all pages
  - Synchronizes image viewer with background popup
  - Automatic page calculation and display updates
  - Seamless image switching with fade animations
- **Improved CORS Handling**: Proper detection and handling of protected images
  - Checks image source field for character photos
  - Identifies characterphoto domain URLs
  - Provides appropriate download method based on image type
  - Better error handling with fallback options
- **Better Event Management**: Clean modal lifecycle with proper cleanup
  - All buttons removed on close for no memory leaks
  - Keyboard listeners properly cleaned up
  - Animation delays handled correctly
  - Proper z-index management for layered modals

### Bug Fixes
- Fixed character icons shrinking when multiple characters in a chat
- Fixed download button failing for CORS-protected images
- Improved mobile responsiveness for character icon layouts

### User Experience
- Faster image browsing with navigation arrows and keyboard shortcuts
- More professional image viewing experience
- Easier access to specific chats via clickable names
- Better download experience with automatic CORS handling
- Consistent visual design across all platforms and screen sizes

-----

## Version 1.2.7 - Mobile Optimization & UX Improvements

### New Features
- **Smart Keyboard Shortcuts**: Added ESC key support with intelligent modal hierarchy
  - ESC closes image popup first if it's open
  - ESC closes export modal if no image popup is open
  - Prevents both modals from closing at once
- **Backdrop Click to Close**: Click outside the export modal to dismiss it
- **Compact UI Elements**: Changed close buttons and pagination controls to use single characters (X, <, >) for better space utilization

### UI/UX Enhancements
- **Full Mobile Responsiveness**: Complete mobile optimization for image popup
  - Responsive header with two-row layout (title + close on top, filters + buttons below)
  - Responsive image cards with better width utilization (two-column layout on mobile)
  - Touch-friendly button sizing with responsive padding and font sizes
  - Improved pagination controls with better wrapping and spacing
- **Solid Button Colors**: Replaced gradient backgrounds with solid accent colors for better readability
  - Text changed to black for improved contrast on colored backgrounds
  - More professional and consistent appearance
- **Reduced Modal Size**: Slightly increased max height (860px from 800px) for better image viewing
- **Compact Character Icons**: Adjusted character icon sizing in chat list for better space efficiency
- **Adjusted Page Size Options**: Changed minimum page size from 10 to 8 for better mobile viewing

### Technical Improvements
- **Improved Duplicate Detection**: Enhanced image deduplication logic
  - Normalized URL comparison to handle query parameter differences
  - Skip primary output_image_url field during iteration to prevent reprocessing
  - More accurate image count display
- **Consistent Modal Behavior**: Unified close behavior across all modals (ESC, backdrop click, close button)
- **Better Event Handling**: Improved cleanup of event listeners on modal close

### User Experience
- Faster and more intuitive image browsing on mobile devices
- Reduced visual clutter with more compact UI elements
- Better readability with improved text contrast
- More consistent behavior across all modal dialogs
- Accurate image counts without unintended duplicates

-----

## Version 1.2.6 - "Chameleon" Update - Site-Specific Color Schemes & Enhanced UI

### New Features
- **Adaptive Color Schemes**: Script now automatically detects the current site and applies appropriate color schemes
  - Moescape.ai: Darker theme with yellow-green accents matching the site's native styling
  - Yodayo.com: Maintains current purple-pink theme for consistency
  - Automatic detection based on hostname - no user configuration needed
- **Clickable Character Icons**: Character profile pictures in chat list are now clickable links
  - Direct navigation to character profiles on both Yodayo and Moescape
  - Site-specific URL formatting (characters/ vs character/)
  - Opens in new tab to preserve chat list context
- **Enhanced Export Button**: Added download icon to main export button for better visual clarity
- **Smart Text Truncation**: Chat names automatically truncate to 3 lines with ellipsis to maintain consistent layout

### UI/UX Enhancements
- **Native Integration**: All UI elements now blend seamlessly with each site's design language
- **Consistent Branding**: "Save your chats" button and modal titles use site-appropriate accent colors
- **Enhanced Visual Harmony**: Chat modals, image popups, and buttons adapt to match site aesthetics
- **Improved User Experience**: Familiar styling on each platform reduces cognitive load
- **Custom Hover Effects**: Download and Images buttons use site-specific hover backgrounds
  - Yodayo: #151820 hover background
  - Moescape: #1A1C1E hover background
- **Interactive Character Icons**: Hover effects with scale and glow animations
- **Tooltip Integration**: Character names displayed on hover for easy identification
- **Clean Icon Design**: Removed fallback letters, showing only character photos or empty circles

### Technical Improvements
- **Dynamic Color System**: Centralized color scheme management with site-specific configurations
- **Automatic Detection**: Seamless switching between color schemes based on current site
- **Future-Proof Design**: Easy to extend with additional sites or color variations
- **Enhanced Button State Management**: Improved text updates while preserving SVG icons
- **Robust URL Handling**: Site-specific character profile URL generation

### User Experience
- **Platform-Native Feel**: Users get familiar styling on their preferred platform
- **Reduced Visual Disruption**: Script UI no longer stands out as "foreign" to the site
- **Consistent Branding**: Maintains each site's visual identity and user expectations
- **Improved Navigation**: Quick access to character profiles directly from chat list
- **Better Visual Feedback**: Clear hover states and tooltips enhance usability
- **Cleaner Layout**: Consistent chat entry heights regardless of name length


-----


## Version 1.2.5 - Image Popup Pagination & UI Improvements

### New Features
- **Image Pagination System**: Added comprehensive pagination to handle large numbers of images efficiently
  - Configurable page sizes: 10, 20, or 50 images per page (default: 20)
  - Previous/Next navigation buttons with proper disabled states
  - Page information display showing "X-Y of Z" format
  - Page jump dropdown for quick navigation to any page
  - Automatic page reset when applying filters

### Performance Improvements
- **Batched Downloads**: Implemented server-friendly download system
  - Downloads images in batches of 5 to prevent server overload
  - 1-second delay between batches to avoid rate limiting
  - Enhanced progress feedback showing current batch progress
  - Comprehensive error handling and recovery

### UI/UX Enhancements
- **Updated UI Color Scheme**: Updated images popup to better match Yodayo/Moescape color scheme
- **Enhanced Button Interactions**: Applied consistent hover effects across all gradient buttons
- **Improved Layout**: Enhanced pagination controls with page jump dropdown and better spacing

### Technical Improvements
- **Smart Pagination Logic**: Cross-page selection support and filter integration
- **Memory Efficiency**: Only renders visible images, improving performance for large image sets
- **Enhanced Logging**: Detailed console logging for debugging pagination and download processes

### Bug Fixes
- Fixed potential server overload when downloading large numbers of images
- Improved error handling for failed downloads
- Enhanced popup blocking prevention for CORS-protected images

### User Experience
- Significantly improved navigation for large image collections
- Reduced server load and rate limiting issues
- Consistent visual design across all components
- More intuitive and responsive interface
