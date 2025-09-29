const fs = require('fs');

// Since we can't easily crop images without additional libraries,
// let's create a simple HTML page that can help crop the image

const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Image Cropper</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        canvas { border: 1px solid #ccc; margin: 10px 0; }
        button { padding: 10px 20px; margin: 5px; }
    </style>
</head>
<body>
    <h1>Image Cropper</h1>
    <p>Original Image:</p>
    <img id="originalImage" src="screenshots/image.png" style="max-width: 100%;">
    
    <p>Cropped Image (top 48px removed):</p>
    <canvas id="canvas"></canvas>
    
    <br>
    <button onclick="downloadCropped()">Download Cropped Image</button>
    
    <script>
        const img = document.getElementById('originalImage');
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = function() {
            const cropHeight = 48; // Remove top 48 pixels
            const newHeight = Math.max(1, img.height - cropHeight);
            
            canvas.width = img.width;
            canvas.height = newHeight;
            
            // Draw the cropped portion
            ctx.drawImage(img, 0, cropHeight, img.width, newHeight, 0, 0, img.width, newHeight);
        };
        
        function downloadCropped() {
            const link = document.createElement('a');
            link.download = 'image_no_topbar.png';
            link.href = canvas.toDataURL();
            link.click();
        }
    </script>
</body>
</html>
`;

fs.writeFileSync('/home/jason/projects/vessel/crop-tool.html', html);
console.log('Created crop-tool.html - open in browser to crop the image');