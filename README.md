# Tavern Chat Downloader

A comprehensive userscript for **Yodayo.com** and **Moescape.ai** that lets you preserve, export, and manage your Tavern AI conversations and generated images.

## What It Does

This script adds powerful export and management tools directly to your Tavern experience, making it easy to backup your conversations, organize generated images, and maintain your creative work.

## Key Features

### Chat Export
- **Multiple Export Formats**: Download chats as TXT, JSON, or JSONL (SillyTavern/OpenAI compatible)
- **Batch Export**: Export individual chats or browse through all your conversations
- **Context-Aware**: Quick access via in-chat settings menu to export the current conversation
- **Character Filtering**: When opened from a chat, automatically filters to show only chats with that character
- **Smart Search**: Instantly search your chats by name or character
- **Advanced Sorting**: Sort by date (newest/oldest), name (A-Z/Z-A), or character (A-Z)

### Image Management
- **Comprehensive Image Viewer**: Professional full-screen modal for viewing generated images
- **Complete Image Collection**: Automatically gathers all images from your chats including:
  - Generated images from AI models
  - Character profile photos
  - Background images
  - Batch-generated images (2-4 at a time)
- **Advanced Filtering**: Filter images by generation type (/image you, /image face, etc.) or view character/background photos separately
- **Pagination Controls**: Navigate large image collections with customizable page sizes (8, 20, or 50 per page)
- **Batch Download**: Select multiple images and download them at once
- **Smart Downloads**: Automatic handling of CORS-protected images

### Image Viewer Modal
- **Full-Screen Experience**: Immersive viewing with blur backdrop and smooth animations
- **Keyboard Navigation**: Use arrow keys to browse, ESC to close
- **Image Metadata Display**: View timestamp, model used, and generation details
- **Expandable Technical Details**: Click the arrow to reveal:
  - Full prompt used for generation
  - Negative prompt
  - Generation settings (size, steps, sampler, CFG scale, seed, batch size)
- **Toggle Controls**: Show/hide metadata with a sleek pill-style toggle
- **Navigation Arrows**: Smoothly browse through all images with left/right arrows
- **Download Button**: Quick download for any image
- **Memory Preference**: Remembers your metadata visibility preference

### Adaptive Design
- **Site-Specific Theming**: Automatically matches Yodayo's purple-pink theme or Moescape's yellow-green theme
- **Fully Responsive**: Optimized layouts for desktop, tablet, and mobile devices
- **Clickable Elements**: 
  - Chat names link to the conversation
  - Character icons link to character profiles
- **Mobile Optimizations**:
  - Character icons adapt size and wrap appropriately
  - Search bar adjusts to prevent overflow
  - Touch-friendly button sizes and spacing

### Quality of Life
- **Persistent Settings**: Your metadata toggle preference is saved across sessions
- **Smart Modal Hierarchy**: ESC key closes only the topmost modal (viewer → popup → export)
- **No Event Stacking**: Proper cleanup prevents issues when reopening modals
- **Smooth Animations**: Polished fade transitions and hover effects throughout
- **Custom Scrollbars**: Styled scrollbars that match the site's aesthetic

## How to Use

1. **Install the script** using your favorite userscript manager (Tampermonkey, Violentmonkey, etc.)
2. **Navigate to Tavern** on Yodayo.com or Moescape.ai
3. **Click "Export Chat/Images"** in the header to open the main exporter
4. **Or use the gear icon** in any chat to access "Export Chat" for quick access

### Exporting Chats
- Click the **Download** button on any chat to export the conversation
- Select your preferred format from the dropdown at the bottom
- Choose from TXT, JSON, or JSONL formats

### Viewing Images
- Click the **Images** button on any chat to view all associated images
- Use the filter dropdown to narrow down image types
- Click any image to open the full-screen viewer
- Click the expand arrow (▼) in the viewer to see generation details
- Use arrow keys or navigation buttons to browse through images
- Select multiple images and click Download to batch-save them

## Supported Sites

- **Yodayo.com** - Full support with purple-pink theme
- **Moescape.ai** - Full support with yellow-green theme

## Version History

See the [Change Log](https://github.com/cyelis1224/moescape-exporter/blob/main/Change_log.txt) for version history.

## Credits

Originally created by **Holly**, now maintained and expanded by **Dagyr** with Holly's blessing. This script represents a community effort to preserve and enhance the Tavern AI experience.

## License

MIT License - Free to use, modify, and share!

## Support & Feedback

Found a bug or have a feature request? Visit the [Issues](https://openuserjs.org/scripts/Dagyr/Tavern_Chat_Downloader/issues) tab to report it!

---

**Enjoy preserving your Tavern conversations!**

