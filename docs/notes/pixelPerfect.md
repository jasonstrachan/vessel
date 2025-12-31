<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pixel Art App</title>
    <!-- Tailwind CSS CDN for styling -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Google Fonts - Inter -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
    <!-- p5.js library -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.4.0/p5.min.js"></script>
    <style>
        /* Apply Inter font to the body */
        body {
            font-family: 'IBM Plex Mono', 'Courier New', monospace;
        }
        /* Basic styling for the canvas container to ensure it's a block element */
        #canvas-container {
            display: block;
            /* Ensure the canvas itself takes up the space within its container */
        }
        canvas {
            display: block; /* Remove extra space below canvas */
        }
    </style>
</head>
<body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
    <!-- Main application container -->
    <div id="app" class="bg-white rounded-lg shadow-xl p-6 flex flex-col md:flex-row gap-6 max-w-4xl w-full">
        <!-- Controls section -->
        <div id="controls" class="flex flex-col gap-4 p-4 bg-gray-50 rounded-md shadow-inner">
            <h2 class="text-xl font-bold text-gray-800 mb-2">Tools</h2>
            <!-- Color Palette -->
            <div class="flex flex-wrap gap-2 justify-center">
                <!-- Color buttons are dynamically created by p5.js sketch -->
            </div>
            <!-- Clear Button -->
            <button id="clearBtn" class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md shadow-md transition-all duration-200 ease-in-out transform hover:scale-105">
                Clear Canvas
            </button>
        </div>
        <!-- Canvas container where p5.js will draw -->
        <div id="canvas-container" class="border-2 border-gray-300 rounded-md overflow-hidden flex-grow flex items-center justify-center">
            <!-- p5.js canvas will be appended here -->
        </div>
    </div>

    <script>
        // --- p5.js Sketch ---

        let canvasWidth = 600; // Fixed width for the pixel art canvas
        let canvasHeight = 600; // Fixed height for the pixel art canvas
        let pixelSize = 10; // The size of each "pixel" in our pixel art grid (e.g., 10x10 actual screen pixels)
        let gridWidth; // Number of "art pixels" horizontally
        let gridHeight; // Number of "art pixels" vertically
        let grid = []; // 2D array to store the color of each "art pixel"
        let currentColor; // The currently selected drawing color
        let isDrawing = false; // Flag to track if the mouse is being dragged for drawing

        // Variables for the 'pixel perfect' drawing logic
        let lastDrawnX = -1; // Grid coordinates of the last pixel actually drawn on the grid
        let lastDrawnY = -1;
        let waitingPixelX = -1; // Grid coordinates of the pixel waiting to be committed (drawn)
        let waitingPixelY = -1;

        // Define the color palette
        const colors = [
            '#000000', // Black
            '#FFFFFF', // White
            '#FF0000', // Red
            '#00FF00', // Green
            '#0000FF', // Blue
            '#FFFF00', // Yellow
            '#FF00FF', // Magenta
            '#00FFFF', // Cyan
            '#FFA500', // Orange
            '#800080'  // Purple
        ];

        /**
         * p5.js setup function: Initializes the canvas and drawing environment.
         * This function is called once when the sketch starts.
         */
        function setup() {
            // Create the p5.js canvas and attach it to the 'canvas-container' div in the HTML.
            let canvas = createCanvas(canvasWidth, canvasHeight);
            canvas.parent('canvas-container');
            noSmooth(); // Disable anti-aliasing for a true pixel-perfect look.

            // Calculate the dimensions of our pixel art grid.
            gridWidth = floor(canvasWidth / pixelSize);
            gridHeight = floor(canvasHeight / pixelSize);

            // Initialize the grid with a default background color (white).
            // Each cell in the grid will store a color value.
            for (let i = 0; i < gridWidth; i++) {
                grid[i] = [];
                for (let j = 0; j < gridHeight; j++) {
                    grid[i][j] = '#FFFFFF'; // Default to white
                }
            }

            currentColor = colors[0]; // Set the initial drawing color to black.

            // --- UI Setup ---
            // Get the div where color palette buttons will be placed.
            const colorPaletteDiv = document.querySelector('#controls .flex-wrap');

            // Create and append color buttons to the palette.
            colors.forEach(colorHex => {
                const colorBtn = document.createElement('button');
                // Add Tailwind classes for styling, including rounded corners and hover effects.
                colorBtn.className = `color-button w-8 h-8 rounded-full border-2 border-gray-300 hover:border-blue-500 transition-all duration-200 ease-in-out shadow-sm`;
                colorBtn.style.backgroundColor = colorHex; // Set the button's background color.
                colorBtn.dataset.color = colorHex; // Store the color value in a data attribute.

                // Add click listener to change the current drawing color.
                colorBtn.onclick = () => {
                    currentColor = colorHex;
                    // Update active state for color buttons
                    document.querySelectorAll('.color-button').forEach(btn => {
                        btn.classList.remove('border-blue-500', 'border-4'); // Remove active style from all
                    });
                    colorBtn.classList.add('border-blue-500', 'border-4'); // Add active style to clicked button
                };
                colorPaletteDiv.appendChild(colorBtn);
            });

            // Set the initial active color button style.
            const initialColorBtn = document.querySelector(`.color-button[data-color="${currentColor}"]`);
            if (initialColorBtn) {
                initialColorBtn.classList.add('border-blue-500', 'border-4');
            }

            // Setup the Clear Canvas button.
            document.getElementById('clearBtn').onclick = clearCanvas;
        }

        /**
         * p5.js draw function: Continuously redraws the canvas.
         * This function is called repeatedly (default 60 times per second).
         */
        function draw() {
            // Iterate through the grid and draw each "art pixel" as a rectangle.
            for (let i = 0; i < gridWidth; i++) {
                for (let j = 0; j < gridHeight; j++) {
                    fill(grid[i][j]); // Set the fill color from the grid's stored color.
                    noStroke(); // Do not draw a border around the rectangles.
                    // Draw a rectangle at the calculated screen position for each "art pixel".
                    rect(i * pixelSize, j * pixelSize, pixelSize, pixelSize);
                }
            }
        }

        /**
         * Implements Bresenham's Line Algorithm to draw a pixel-perfect line on the grid.
         * This algorithm determines which grid cells should be filled to form a line
         * without anti-aliasing, ensuring a sharp, "pixel art" look.
         * @param {number} x0 - Starting X grid coordinate.
         * @param {number} y0 - Starting Y grid coordinate.
         * @param {number} x1 - Ending X grid coordinate.
         * @param {number} y1 - Ending Y grid coordinate.
         * @param {string} color - The color to draw the line with (hex string).
         */
        function drawLineBresenham(x0, y0, x1, y1, color) {
            let dx = abs(x1 - x0);
            let dy = abs(y1 - y0);
            // Determine the direction of movement along X and Y axes.
            let sx = (x0 < x1) ? 1 : -1;
            let sy = (y0 < y1) ? 1 : -1;
            let err = dx - dy; // Error term to decide whether to move along X or Y.

            while (true) {
                // Ensure the current pixel is within grid bounds before attempting to draw.
                if (x0 >= 0 && x0 < gridWidth && y0 >= 0 && y0 < gridHeight) {
                    grid[x0][y0] = color; // Set the color of the current grid cell.
                }

                // If the end point is reached, break the loop.
                if (x0 === x1 && y0 === y1) break;

                let e2 = 2 * err; // Calculate 2 * error for decision making.

                // If error is greater than -dy, move along X.
                if (e2 > -dy) {
                    err -= dy;
                    x0 += sx;
                }
                // If error is less than dx, move along Y.
                if (e2 < dx) {
                    err += dx;
                    y0 += sy;
                }
            }
        }

        /**
         * Draws a segment on the grid. This function acts as the 'actionDraw'
         * from the referenced article, using Bresenham's for line segments.
         * @param {number} x0 - Start X grid coordinate.
         * @param {number} y0 - Start Y grid coordinate.
         * @param {number} x1 - End X grid coordinate.
         * @param {number} y1 - End Y grid coordinate.
         * @param {string} color - The color to draw with.
         */
        function drawSegment(x0, y0, x1, y1, color) {
            // Only draw if the coordinates are valid
            if (x0 >= 0 && x0 < gridWidth && y0 >= 0 && y0 < gridHeight &&
                x1 >= 0 && x1 < gridWidth && y1 >= 0 && y1 < gridHeight) {
                drawLineBresenham(x0, y0, x1, y1, color);
            }
        }

        /**
         * Implements the 'pixel perfect' logic from the user's reference.
         * This function manages the drawing based on mouse movement, ensuring
         * continuity and filling gaps for fast drawing without pixel doubling.
         * @param {number} currentX - Current X grid coordinate of the mouse.
         * @param {number} currentY - Current Y grid coordinate of the mouse.
         */
        function perfectPixels(currentX, currentY) {
            // If this is the very first pixel of a new stroke
            if (lastDrawnX === -1) {
                lastDrawnX = currentX;
                lastDrawnY = currentY;
                waitingPixelX = currentX;
                waitingPixelY = currentY;
                // Draw the initial single pixel
                drawSegment(currentX, currentY, currentX, currentY, currentColor);
                return;
            }

            // Check if the current pixel is NOT adjacent to the last *drawn* pixel.
            // This indicates a "jump" or fast mouse movement that skipped pixels.
            if (abs(currentX - lastDrawnX) > 1 || abs(currentY - lastDrawnY) > 1) {
                // If a jump occurred, draw a line from the last *drawn* pixel
                // to the *waiting* pixel. This fills the gap.
                drawSegment(lastDrawnX, lastDrawnY, waitingPixelX, waitingPixelY, currentColor);

                // Update the 'lastDrawn' to the pixel that was just committed (the former waiting pixel).
                lastDrawnX = waitingPixelX;
                lastDrawnY = waitingPixelY;

                // The current mouse position becomes the new 'waiting' pixel.
                waitingPixelX = currentX;
                waitingPixelY = currentY;
            } else {
                // If the current pixel IS adjacent to the last *drawn* pixel,
                // just update the 'waiting' pixel to the current mouse position.
                // We don't draw yet, as per the article's logic, we wait for a jump
                // or end of stroke to commit the waiting pixel.
                waitingPixelX = currentX;
                waitingPixelY = currentY;
            }
        }

        /**
         * p5.js mousePressed function: Called once when a mouse button is pressed.
         */
        function mousePressed() {
            // Check if the mouse click is within the canvas boundaries.
            if (mouseX >= 0 && mouseX < width && mouseY >= 0 && mouseY < height) {
                isDrawing = true; // Set drawing flag to true.
                // Convert mouse coordinates to grid coordinates.
                let currentGridX = floor(mouseX / pixelSize);
                let currentGridY = floor(mouseY / pixelSize);

                // Ensure the current drawing point is within the grid boundaries.
                if (currentGridX >= 0 && currentGridX < gridWidth && currentGridY >= 0 && currentGridY < gridHeight) {
                    // Reset drawing state for a new stroke
                    lastDrawnX = -1;
                    lastDrawnY = -1;
                    waitingPixelX = -1;
                    waitingPixelY = -1;
                    perfectPixels(currentGridX, currentGridY); // Start the perfectPixels drawing logic
                }
            }
        }

        /**
         * p5.js mouseDragged function: Called repeatedly while the mouse is dragged.
         */
        function mouseDragged() {
            if (isDrawing) {
                // Check if the mouse is within the canvas boundaries during dragging.
                if (mouseX >= 0 && mouseX < width && mouseY >= 0 && mouseY < height) {
                    let currentGridX = floor(mouseX / pixelSize);
                    let currentGridY = floor(mouseY / pixelSize);

                    // Ensure the current drawing point is within the grid boundaries.
                    if (currentGridX >= 0 && currentGridX < gridWidth &&
                        currentGridY >= 0 && currentGridY < gridHeight) {
                        perfectPixels(currentGridX, currentGridY); // Pass current mouse position to perfectPixels
                    }
                }
            }
        }

        /**
         * p5.js mouseReleased function: Called once when a mouse button is released.
         */
        function mouseReleased() {
            if (isDrawing) {
                // When drawing stops, ensure the final waiting pixel is drawn.
                // This commits the last segment of the line.
                drawSegment(lastDrawnX, lastDrawnY, waitingPixelX, waitingPixelY, currentColor);
                
                isDrawing = false;
                // Reset state for the next drawing session
                lastDrawnX = -1;
                lastDrawnY = -1;
                waitingPixelX = -1;
                waitingPixelY = -1;
            }
        }

        /**
         * Clears the entire canvas by resetting all grid cells to white.
         */
        function clearCanvas() {
            for (let i = 0; i < gridWidth; i++) {
                for (let j = 0; j < gridHeight; j++) {
                    grid[i][j] = '#FFFFFF'; // Reset to white
                }
            }
        }
    </script>
</body>
</html>
