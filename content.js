const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                // 1. Check downwards from the new node.
                let likeButton = findLikeButton(node);

                // 2. If not found, check upwards from the new node.
                if (!likeButton) {
                    const parentButton = node.closest('button');
                    if (parentButton) {
                        likeButton = findLikeButton(parentButton);
                    }
                }
                
                // If the button is found and our button doesn't exist yet, inject it.
                if (likeButton && !likeButton.parentElement.querySelector('.mj-style-saver-btn')) {
                    injectSaveButton(likeButton);
                }
            }
        }
    }
});


/**
 * Recursively checks if a node or its descendants contains a text node with the specified content.
 * @param {Node} node The starting node.
 * @param {string} text The text to find.
 * @returns {boolean} True if the text node is found.
 */
function hasTextNodeRecursive(node, text) {
    if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim() === text) {
            return true;
        }
    }
    for (const child of node.childNodes) {
        if (hasTextNodeRecursive(child, text)) {
            return true;
        }
    }
    return false;
}

/**
 * Finds the "Like" button using the most robust method: checking for an SVG icon and
 * recursively searching for a text node that contains exactly "Like".
 * @param {Element} element The element to search within.
 * @returns {Element|null} The found button or null.
 */
function findLikeButton(element) {
    // Ensure we are working with an element.
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }

    const potentialButtons = element.matches('button') ? [element] : Array.from(element.querySelectorAll('button'));

    for (const button of potentialButtons) {
        const hasSVG = button.querySelector('svg');
        if (hasSVG && hasTextNodeRecursive(button, 'Like')) {
            return button;
        }
    }
    return null;
}


/**
 * Recursively finds a text node with specific content and replaces it.
 * @param {Node} node The starting node.
 * @param {string} findText The text to find.
 * @param {string} replaceText The text to replace with.
 * @returns {boolean} True if text was found and replaced, otherwise false.
 */
function replaceTextInNode(node, findText, replaceText) {
    if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.includes(findText)) {
            node.textContent = node.textContent.replace(findText, replaceText);
            return true;
        }
    } else {
        for (const child of node.childNodes) {
            if (replaceTextInNode(child, findText, replaceText)) {
                return true; // Stop after the first replacement
            }
        }
    }
    return false;
}


function injectSaveButton(likeButton) {
    const saveButton = likeButton.cloneNode(true);
    saveButton.classList.add('mj-style-saver-btn');
    saveButton.removeAttribute('id');

    const downloadIconSVG = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" height="18" width="18" class="inline-block shrink-0">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
    `;
    
    replaceTextInNode(saveButton, 'Like', 'Save');
    const svgElement = saveButton.querySelector('svg');
    if (svgElement) {
        svgElement.outerHTML = downloadIconSVG;
    }
    
    likeButton.insertAdjacentElement('afterend', saveButton);
    saveButton.addEventListener('click', handleSaveClick);
}

async function handleSaveClick(event) {
    const saveButton = event.currentTarget;
    
    saveButton.disabled = true;
    replaceTextInNode(saveButton, 'Save', 'Saving...');
    
    try {
        // --- Robust Popup and Image Grid Detection ---
        let popupRoot = null;
        let imageElements = [];
        
        let currentElement = saveButton.parentElement;
        while (currentElement && currentElement !== document.body) {
            const potentialImages = Array.from(currentElement.querySelectorAll('img[src*="_640_N.webp"]'));
            if (potentialImages.length > 4) {
                popupRoot = currentElement;
                imageElements = potentialImages;
                break;
            }
            currentElement = currentElement.parentElement;
        }

        if (!popupRoot) {
            throw new Error('Could not find the main style popup element. The website structure may have changed.');
        }

        if (imageElements.length < 8) {
             throw new Error(`Expected 8 images, but found only ${imageElements.length}. Please wait for all images to load.`);
        }

        // --- Definitive SREF Code Extraction (from Image URL) ---
        let srefCode = null;
        for (const img of imageElements) {
            const srefRegex = /styles\/0_(\d+)\//;
            const match = img.src.match(srefRegex);
            if (match && match[1]) {
                srefCode = match[1];
                break; // Found it, stop looking.
            }
        }
        
        if (!srefCode || !/^\d+$/.test(srefCode)) {
            throw new Error(`Invalid SREF code found (${srefCode}). The URL structure may have changed.`);
        }

        const { storageMethod } = await chrome.storage.sync.get({ storageMethod: 'auto' });
        
        // --- Dual-Path Download Logic ---

        if (storageMethod === 'auto') {
            // Path 1: Automatic Save (handled entirely in content script)
            await handleAutoDownloadInContent(srefCode, imageElements);
            replaceTextInNode(saveButton, 'Saving...', 'Saved!');
            setTimeout(() => {
                replaceTextInNode(saveButton, 'Saved!', 'Save');
                saveButton.disabled = false;
            }, 2000);
        } else {
            // Path 2: Prompted Save (delegated to background script)
            await handlePromptDownloadViaBackground(srefCode, imageElements, saveButton);
        }

    } catch (error) {
        console.error('MJ Style Saver Error:', error.message);
        replaceTextInNode(saveButton, 'Saving...', 'Error!');
        setTimeout(() => {
            replaceTextInNode(saveButton, 'Error!', 'Save');
            saveButton.disabled = false;
        }, 3000);
    }
}

async function handlePromptDownloadViaBackground(srefCode, imageElements, saveButton) {
     const coverImageDataUrl = await createCoverImage(imageElements);
     const imageUrls = [...new Set(imageElements.map(img => img.src))];

    const imageFiles = imageUrls.map(url => {
        const parts = url.split('/');
        const imageNameWithExt = parts[parts.length - 1];
        return {
            url: url,
            name: `${srefCode}_${imageNameWithExt}`
        };
    });

    chrome.runtime.sendMessage({
        action: 'download_style',
        sref: srefCode,
        images: imageFiles,
        cover: {
            dataUrl: coverImageDataUrl,
            name: `${srefCode}_cover.jpg`
        },
        storageMethod: 'prompt'
    }, (response) => {
        if (chrome.runtime.lastError || (response && !response.success)) {
             const errorMessage = chrome.runtime.lastError ? chrome.runtime.lastError.message : response.error;
             console.error('MJ Style Saver Error:', errorMessage);
             replaceTextInNode(saveButton, 'Saving...', 'Error!');
             setTimeout(() => {
                 replaceTextInNode(saveButton, 'Error!', 'Save');
                 saveButton.disabled = false;
             }, 3000);
        } else if (response && response.success) {
            // The prompt page is open, the user will handle it from there.
            replaceTextInNode(saveButton, 'Saving...', 'Save');
            saveButton.disabled = false;
        }
    });
}

async function handleAutoDownloadInContent(srefCode, imageElements) {
    const { format } = await chrome.storage.sync.get({ format: 'original' });
    const coverImageDataUrl = await createCoverImage(imageElements);
    const imageUrls = [...new Set(imageElements.map(img => img.src))];
    const srefSanitized = sanitize(srefCode);
    const zip = new JSZip();

    const fetchQueue = imageUrls.map(url => {
        const parts = url.split('/');
        const imageNameWithExt = parts[parts.length - 1];
        return {
            url,
            name: `${srefSanitized}_${sanitize(imageNameWithExt)}`,
            type: 'image'
        };
    });
    
    fetchQueue.push({
        url: coverImageDataUrl,
        name: `${srefSanitized}_cover.jpg`,
        type: 'cover'
    });

    const imageBlobs = await Promise.all(fetchQueue.map(async item => {
         try {
            const response = await fetch(item.url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const blob = await response.blob();
            
            if (item.type === 'image' && format !== 'original') {
                const requestedMimeType = `image/${format === 'jpg' ? 'jpeg' : 'png'}`;
                if (blob.type !== requestedMimeType) {
                    const convertedBlob = await convertImageBlob(blob, requestedMimeType);
                    const originalExt = item.name.split('.').pop();
                    const newName = item.name.replace(new RegExp(`\\.${originalExt}$`), `.${format}`);
                    return { name: newName, blob: convertedBlob };
                }
            }
            return { name: item.name, blob };
        } catch (error) {
            console.error(`Failed to fetch/process ${item.url}:`, error);
            return null;
        }
    }));
    
    for (const item of imageBlobs) {
        if (item) {
            zip.file(item.name, item.blob);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(zipBlob);
    
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `sref_${srefSanitized}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
}


/**
 * Creates a cover image by re-fetching images to avoid cross-origin canvas tainting.
 * @param {HTMLImageElement[]} imageElements An array of the original <img> elements from the page.
 * @returns {Promise<string>} A promise that resolves with the Data URL of the generated JPEG image.
 */
async function createCoverImage(imageElements) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not create canvas context.");

    if (imageElements.length === 0) {
        throw new Error("No images provided for cover.");
    }
    
    const imageUrls = imageElements.map(img => img.src);
    const objectUrls = [];

    try {
        const loadedImages = await Promise.all(imageUrls.map(async (url) => {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${url} (status: ${response.status})`);
            }
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            objectUrls.push(objectUrl); // Keep track for cleanup

            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`Failed to load image from blob URL for: ${url}`));
                img.src = objectUrl;
            });
        }));

        const cellWidth = 640;
        const cellHeight = 960;
        const cols = 4;
        const rows = 2;

        canvas.width = cellWidth * cols;
        canvas.height = cellHeight * rows;

        loadedImages.forEach((img, index) => {
            const row = Math.floor(index / cols);
            const col = index % cols;
            const dx = col * cellWidth;
            const dy = row * cellHeight;
            ctx.drawImage(img, dx, dy, cellWidth, cellHeight);
        });

        return canvas.toDataURL('image/jpeg', 0.9);

    } finally {
        objectUrls.forEach(url => URL.revokeObjectURL(url));
    }
}


function sanitize(name) {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/[\\\/:\*\?"<>\|]/g, '_').replace(/\s/g, '_');
}

async function convertImageBlob(blob, type) {
    const imageBitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    if (type === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    ctx.drawImage(imageBitmap, 0, 0);
    
    return new Promise((resolve, reject) => {
        const quality = type === 'image/jpeg' ? 0.9 : undefined;
        canvas.toBlob(blob => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error('Canvas toBlob returned null.'));
            }
        }, type, quality);
    });
}


observer.observe(document.body, { childList: true, subtree: true });