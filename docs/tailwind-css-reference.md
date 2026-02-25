# Tailwind CSS Reference Documentation

This document contains reference information about Tailwind CSS utilities, components, and best practices extracted from the official documentation.

## Overview

Tailwind CSS is a utility-first CSS framework that rapidly builds custom designs by scanning HTML for class names and generating corresponding static CSS, offering a fast, flexible, and zero-runtime styling solution.

## Installation

### Standard Installation
```bash
npm install -D tailwindcss@latest postcss autoprefixer
```

### Tailwind CSS v4 Installation
```bash
npm install tailwindcss@next @tailwindcss/cli@next
```

### CLI Installation
```bash
npm install tailwindcss@latest @tailwindcss/cli@latest
```

### With Vite
```bash
npm install tailwindcss@latest @tailwindcss/vite@latest
```

### With PostCSS
```bash
npm install tailwindcss@latest @tailwindcss/postcss@latest
```

## Core Concepts

### Utility-First Approach
Tailwind uses atomic utility classes instead of component-based CSS. Example responsive component:

```jsx
<div className="mx-auto max-w-sm space-y-2 rounded-xl bg-white px-8 py-8 shadow-lg ring ring-black/5 @sm:flex @sm:items-center @sm:space-y-0 @sm:gap-x-6 @sm:py-4">
  <img
    className="mx-auto block h-24 rounded-full @sm:mx-0 @sm:shrink-0"
    src={profileImage}
    alt="Profile"
  />
  <div className="space-y-2 text-center @sm:text-left">
    <div className="space-y-0.5">
      <p className="text-lg font-semibold text-black">John Doe</p>
      <p className="font-medium text-gray-500">Product Engineer</p>
    </div>
    <button className="rounded-full border border-purple-200 px-4 py-1 text-sm font-semibold text-purple-600 hover:border-transparent hover:bg-purple-600 hover:text-white active:bg-purple-700">
      Message
    </button>
  </div>
</div>
```

## Layout Utilities

### Grid System
```html
<!-- Basic grid with 6 columns -->
<div class="grid grid-cols-6 gap-4">
  <div class="col-span-4 col-start-2">01</div>
  <div class="col-start-1 col-end-3">02</div>
  <div class="col-span-2 col-end-7">03</div>
  <div class="col-start-1 col-end-7">04</div>
</div>
```

### Flexbox
```html
<!-- Align items to start -->
<div class="grid justify-items-start">
  <div>01</div>
  <div>02</div>
  <div>03</div>
</div>
```

### Place Self
```jsx
<div className="grid grid-cols-3 place-items-stretch gap-4">
  <div className="place-self-start">Aligned to start</div>
</div>
```

### Align Content
```html
<div class="grid h-56 grid-cols-3 content-start gap-4">
  <div>01</div>
  <div>02</div>
  <div>03</div>
</div>
```

## Typography

### Vertical Alignment
```html
<!-- Align to baseline -->
<span class="inline-block align-baseline">The quick brown fox...</span>
```

### Text Truncation
```jsx
<p className="truncate text-sm text-slate-500">long-email@example.com</p>
```

## Styling Features

### Pseudo-elements
```html
<!-- Content utility for pseudo-elements -->
<p class="before:content-['Mobile'] md:before:content-['Desktop']"></p>
```

### Responsive Design
```html
<!-- Responsive content changes -->
<p class="before:content-['Mobile'] md:before:content-['Desktop']"></p>
```

### Hover States
```html
<!-- Conditional hover effects -->
<button class="bg-indigo-500 hover:enabled:bg-indigo-400 disabled:opacity-75" disabled>
  Processing...
</button>
```

### Dark Mode Support
```jsx
<div className="bg-white dark:bg-slate-900">
  <p className="text-zinc-950 dark:text-white">Content</p>
</div>
```

## Advanced Features

### CSS Imports (v3.1+)
```css
@import "tailwindcss/base";
@import "./custom-components.css";
@import "tailwindcss/components";
@import "tailwindcss/utilities";
```

### Border Spacing (Tables)
```jsx
<table className="w-full border-separate border-spacing-2">
  <thead className="bg-slate-100 dark:bg-slate-700">
    <tr>
      <th className="border border-slate-300 p-4">Header</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td className="border border-slate-300 p-4">Data</td>
    </tr>
  </tbody>
</table>
```

### Dialog Backdrop Styling
```html
<dialog class="backdrop:bg-slate-900/50">
  <form method="dialog">
    <button>Close</button>
  </form>
</dialog>
```

### Accessibility (Contrast Preferences)
```html
<form>
  <input class="border-slate-200 contrast-more:border-slate-400 contrast-more:placeholder-slate-500" />
  <p class="opacity-10 contrast-more:opacity-100">Help text</p>
</form>
```

### Animation with @starting-style (v4+)
```html
<div class="transition-discrete starting:open:opacity-0 ...">
  <!-- Animates from opacity-0 when first displayed -->
</div>
```

### Column Breaks
```html
<div class="columns-2">
  <p>First paragraph...</p>
  <p class="break-after-column">Break after this</p>
  <p>This starts in new column...</p>
</div>
```

## Component Patterns

### User List Component
```jsx
<ul className="space-y-3">
  <li className="flex">
    <img className="h-10 w-10 rounded-full" src="avatar.jpg" alt="" />
    <div className="ml-3 overflow-hidden">
      <p className="text-sm font-medium text-slate-900">John Doe</p>
      <p className="truncate text-sm text-slate-500">john@example.com</p>
    </div>
  </li>
</ul>
```

### Description Lists
```jsx
<dl className="grid grid-cols-1 text-base/6 sm:grid-cols-[min(50%,theme(spacing.80))_auto]">
  <dt className="col-start-1 border-t border-zinc-950/5 pt-3 text-zinc-500">
    Customer
  </dt>
  <dd className="pt-1 pb-3 text-zinc-950 sm:border-t sm:border-zinc-950/5">
    Michael Foster
  </dd>
</dl>
```

## Configuration

### Tailwind CSS v4 Setup
```js
// postcss.config.js
export default {
  plugins: ["@tailwindcss/postcss"]
};
```

```css
/* main.css */
@import "tailwindcss";
```

## Integration with React Libraries

### Headless UI Components
```jsx
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";

function Example() {
  return (
    <Menu>
      <MenuButton>My account</MenuButton>
      <MenuItems
        transition
        className="transition ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        <MenuItem>Profile</MenuItem>
        <MenuItem>Settings</MenuItem>
      </MenuItems>
    </Menu>
  );
}
```

### Combobox with Virtualization
```jsx
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";

function VirtualizedCombobox() {
  return (
    <Combobox virtual={{ options: largeDataset }}>
      <ComboboxInput />
      <ComboboxButton>
        <ChevronDownIcon />
      </ComboboxButton>
      <ComboboxOptions>
        {({ option }) => (
          <ComboboxOption key={option.id} value={option}>
            {option.name}
          </ComboboxOption>
        )}
      </ComboboxOptions>
    </Combobox>
  );
}
```

## Best Practices

1. **Use responsive prefixes** for different screen sizes
2. **Combine utilities** for complex layouts
3. **Leverage dark mode variants** for better UX
4. **Use semantic naming** in custom CSS when needed
5. **Optimize for accessibility** with contrast utilities
6. **Take advantage of CSS imports** for better organization

## Development Workflow

### Development Server
```bash
pnpm run dev
```

### Dependencies Installation
```bash
pnpm install
```

This reference covers the most commonly used Tailwind CSS utilities and patterns. For the most up-to-date information, refer to the official Tailwind CSS documentation.