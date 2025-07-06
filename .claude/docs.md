## Our Documentation Process

Here's how we'll approach documentation for our app. This living documentation, stored in the `/docs` directory, is critical for our shared understanding and efficient development, enabling you to build new features, maintain existing ones, and fix issues effectively.

### 🧠 THINKING MODE 
THINK HARD, THINK DEEP, WORK IN ULTRATHINK MODE! Every pattern discovered must be captured, every anti-pattern documented, every learning preserved for future developers. 

### 1\. Documentation Structure

All documentation will reside within the `/docs` directory and follow this simplified structure:

    /docs
    ├── 01_Project_Fundamentals/
    │   ├── Vision_Goals.md           (App purpose and main objectives)
    │   └── Core_Tech_Stack.md        (Key technologies, languages, frameworks, database)
    ├── 02_System_Architecture/
    │   ├── Overall_Design.md         (High-level component interaction)
    │   └── Data_Model.md             (Simplified database schema or key data entities)
    ├── 03_Features/
    │   ├── Feature_Name_A.md         (e.g., User_Authentication.md, Product_Listing.md)
    │   ├── Feature_Name_B.md
    │   └── ...
    ├── 04_Operations_Troubleshooting/
    │   ├── Deployment_Guide.md       (How to deploy the app)
    │   └── Common_Issues.md          (Known problems and their solutions)
    └── README.md                     (Quick start guide for the docs themselves)
    

-   **Atomic Documents:** Each Markdown file (`.md`) should focus on a single, distinct topic, feature, or component. This ensures you can pinpoint and retrieve specific information efficiently.
    
-   **Logical Naming:** Files and directories will use descriptive, kebab-cased names. Numeric prefixes (`01_`, `02_`) enforce logical ordering within directories.
    

### 2\. How to Write and Interpret Documentation

When writing or interpreting documentation, adhere to these guidelines:

#### Core Principles

-   **Clarity and Conciseness:** Documentation is direct and to the point. Avoid jargon where possible, or ensure it's clearly defined.
    
-   **Fact-Focused:** Prioritize concrete information: inputs, outputs, explicit rules, and dependencies.
    
-   **Up-to-date:** This is paramount. If the code changes, the relevant documentation **must** be updated immediately. Outdated information is misleading and counterproductive.
    
-   **Markdown Standard:** All documentation uses standard Markdown for consistent formatting and easy parsing.
    

#### Content Guidelines per Document Type

-   **Headings:** Use clear, hierarchical headings (e.g., `# Top Level`, `## Section`, `### Sub-section`) to structure content.
    
-   **Introductions:** Each document begins with a brief summary of its content and purpose.
    
-   **Definitions:** Define any technical terms or acronyms upon their first use.
    

##### `01_Project_Fundamentals/`

-   **Vision\_Goals.md:** State the app's core purpose and 2-3 primary objectives.
    
-   **Core\_Tech\_Stack.md:** List major technologies used (languages, frameworks, libraries, database type).
    

##### `02_System_Architecture/`

-   **Overall\_Design.md:** Provide a high-level description of main services/components and how they communicate. Reference simple diagrams if available.
    
-   **Data\_Model.md:** List key entities and their most important attributes/relationships.
    
    -   **For example (Data Entity):**
        
            ### User Entity
            - `id` (UUID, Primary Key)
            - `email` (String, Unique)
            - `username` (String)
            - **Relationships:** One-to-many with 'Art_Project' (a user can create many projects).
            
        

##### `03_Features/`

-   Each `Feature_Name.md` file (e.g., `User_Authentication.md`):
    
    -   **Purpose:** Clearly state what the feature accomplishes.
        
    -   **Core Flows:** Outline the main steps of user interaction or system process.
        
    -   **Key Inputs/Outputs:** Explicitly define the data expected as input and the data returned as output. Use concise lists or JSON examples. This is crucial for your understanding of feature behavior.
        
    -   **Dependencies:** List any other features or services this feature relies upon.
        
    -   **Business Rules:** Document any specific conditions, constraints, or logic governing the feature's behavior (e.g., "Passwords must include a special character").
        

##### `04_Operations_Troubleshooting/`

-   **Deployment\_Guide.md:** Provide clear, step-by-step instructions for deploying the application. Include environment variables, build steps, and startup commands.
    
-   **Common\_Issues.md:** List frequently encountered problems. For each, describe the symptoms, diagnostic steps, and the resolution. This is vital for efficient troubleshooting.
    

### 3\. Documentation Workflow

Integrate documentation into your development process:

1.  **Design First:** Before writing code for a new feature, draft its specification in `03_Features/`. This ensures a clear understanding of requirements.
    
2.  **Code and Document in Parallel:** As you implement, update the relevant architectural, technical, or feature-specific documents.
    
3.  **Review and Validate:** Treat documentation like code. Review it for accuracy, completeness, and clarity.
    
4.  **Update on Change:** Whenever code is modified, a bug is fixed, or a new operational procedure is established, update the affected documentation.
    
5.  **Version Control:** All documentation will be stored alongside the codebase in our version control system (Git) for history, collaboration, and consistency.
    

By following these instructions, you'll ensure that our `/docs` directory is a reliable and actionable knowledge base, empowering you to perform your tasks more effectively.

-------------------------------------
## Server Management

### Development Server Commands
```bash
# Preferred method (most reliable):
npx next dev

# Alternative with custom port:
npx next dev --port 3001

# For container/network access:
npx next dev --hostname 0.0.0.0
```

### Common Server Issues & Solutions

#### Issue: Server shows "Ready" but connection refused
**Cause**: WSL2 networking binding issues, localhost vs 127.0.0.1 resolution problems
**Solution**: 
1. Use explicit hostname binding: `npx next dev --hostname 0.0.0.0`
2. Run in background: `nohup npx next dev --hostname 0.0.0.0 --port 3000 > server.log 2>&1 &`
3. Test with 127.0.0.1: `curl -I http://127.0.0.1:3000` (not localhost)
4. For persistent fix: Configure WSL2 mirrored networking in `~/.wslconfig`

#### Issue: Port conflicts
**Solution**: `pkill -f next && npx next dev`

#### Issue: Build errors blocking server
**Common fixes**:
- Replace `<a href="/">` with `<Link href="/">` in Next.js pages
- Add missing imports: `import Link from 'next/link'`
- Fix TypeScript/ESLint warnings that block compilation

### Testing Commands
```bash
# Always verify server is working (use 127.0.0.1 in WSL2):
curl -I http://127.0.0.1:3000

# Check listening ports:
ss -tulpn | grep :3000

# View running Next.js processes:
ps aux | grep next

# WSL2 Networking Fix:
echo -e "[wsl2]\nnetworkingMode=mirrored\nlocalhostForwarding=true" > ~/.wslconfig
# Copy to Windows: cp ~/.wslconfig /mnt/c/Users/$(whoami)/.wslconfig
```

## Architecture

### Key Components
- **Canvas**: P5.js-based drawing surface (`/src/components/canvas/`)
- **Toolbar**: Brush tools and settings (`/src/components/toolbar/`)
- **Timeline**: Frame and layer management (`/src/components/timeline/`)
- **Store**: Zustand state management (`/src/stores/useAppStore.ts`)

### Design System
- **Colors**: Dark theme with `#1a1a1a` background, `#2a2a2a` surfaces, `#60a5fa` accents
- **Layout**: Sidebar toolbar, main canvas, bottom timeline
- **Typography**: System fonts, consistent sizing

### File Structure
```
src/
├── app/
│   ├── page.tsx          # Main application
│   ├── layout.tsx        # Root layout
│   ├── globals.css       # Global styles
│   └── debug/page.tsx    # Debug console
├── components/
│   ├── canvas/           # Drawing canvas components
│   ├── toolbar/          # Tool and brush controls
│   ├── timeline/         # Animation timeline
│   └── ui/               # Shared UI components
├── hooks/                # Custom React hooks
├── stores/               # State management
├── types/                # TypeScript definitions
└── utils/                # Utility functions
```

## Development Workflow

### Before Making Changes
1. Ensure server is running: `npx next dev`
2. Test in browser: `http://localhost:3000`
3. Check for TypeScript errors: `npm run build`

### Design Implementation Process
1. Update global CSS for theme changes
2. Modify component styles to match design
3. Test functionality after visual changes
4. Commit changes with descriptive messages

### Common Tasks

#### Adding New Tools
1. Add tool type to `/src/types/index.ts`
2. Update toolbar with new tool button
3. Implement tool logic in canvas component
4. Add tool-specific settings if needed

#### Styling Updates
1. Use exact hex colors from design: `#1a1a1a`, `#2a2a2a`, `#60a5fa`
2. Maintain consistent spacing and typography
3. Test dark theme across all components

#### State Management
- Use Zustand store (`useAppStore`) for global state
- Keep component-specific state local when possible
- Update store actions for new features

## Environment Notes

### WSL2 Specific
- Use `npx next dev --hostname 0.0.0.0` for proper network binding
- Test connectivity with `curl -I http://127.0.0.1:3000` (not localhost)
- Configure mirrored networking in `~/.wslconfig` for persistent fix
- Run in background: `nohup npx next dev --hostname 0.0.0.0 --port 3000 > server.log 2>&1 &`

### Build Requirements
- Node.js with npm
- Next.js 15.3.4
- TypeScript support
- Tailwind CSS for styling

## Troubleshooting Quick Reference

```bash
# Server won't start (WSL2):
pkill -f next && nohup npx next dev --hostname 0.0.0.0 --port 3000 > server.log 2>&1 &

# Port issues:
pkill -f next && npx next dev --hostname 0.0.0.0 --port 3001

# Build errors:
npm run build  # See specific errors to fix

# Test server (WSL2):
curl -I http://127.0.0.1:3000

# Check server logs:
tail -f server.log
```

## Best Practices

1. **Always fix build errors before starting server**
2. **Use explicit hostname binding in WSL2** (`--hostname 0.0.0.0`)
3. **Test with 127.0.0.1 instead of localhost in WSL2**
4. **Follow dark theme design system consistently**
5. **Keep components focused and reusable**
6. **Use TypeScript for better development experience**

---

## Current Status

### Server Status ✅
- **Running**: http://127.0.0.1:3000 (WSL2 with 0.0.0.0 binding)
- **Build**: Successful (no errors)
- **Networking**: Fixed WSL2 localhost resolution issues
- **Background Process**: Running via nohup with server.log
- **Drawing**: Fully functional

### What Was Reverted
- All grid mode experimental code removed
- Build cache cleared (.next directory)
- DragNumber.tsx and other created files deleted
- No more grid mode console logs or hydration warnings

### Working Features
- Distance-based brush spacing system
- Pixel-perfect toggle functionality  
- Custom brush creation and selection
- Dotted brush patterns
- Layer management and animation timeline
- Dark theme UI with responsive design

---

## Development Best Practices

- Always post a link to the dev server after an update

**Last Updated**: 2025-07-01  
**Next.js Version**: 15.3.4  
**Environment**: WSL2 Ubuntu