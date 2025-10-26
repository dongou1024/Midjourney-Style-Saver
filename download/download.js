// This script runs in a visible, active helper page.
// It waits for a user click on the "Start Download" button to create a trusted
// "user gesture". The entire download process is then executed within that gesture.

// UI Elements
const filenameEl = document.getElementById('filename');
const downloadBtn = document.getElementById('download-btn');
const btnText = document.getElementById('btn-text');
const iconDownload = document.getElementById('icon-download');
const iconSpinner = document.getElementById('icon-spinner');

let requestData = null; // To store the download data

/**
 * Retrieves data from chrome.storage.local with a retry mechanism.
 * @param {string} key The storage key to retrieve.
 * @returns {Promise<any>} A promise that resolves with the stored data.
 */
async function getDataFromStorage(key) {
    const MAX_RETRIES = 10;
    const RETRY_DELAY_MS = 100;
    for (let i = 0; i < MAX_RETRIES; i++) {
        const result = await chrome.storage.local.get(key);
        if (result && result[key]) {
            // Clean up the storage immediately after retrieval
            chrome.storage.local.remove(key);
            return result[key];
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
    throw new Error(`Download data not found in storage for key "${key}".`);
}

/**
 * Main initialization function that runs on page load.
 */
async function init() {
    // Apply theme from storage
    const { theme } = await chrome.storage.sync.get({ theme: 'system' });
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    }

    const urlParams = new URLSearchParams(window.location.search);
    const downloadId = urlParams.get('id');

    if (!downloadId) {
        showError('No download ID found.');
        return;
    }

    try {
        requestData = await getDataFromStorage(downloadId);
        if (!requestData || !requestData.sref) {
            throw new Error("Invalid or missing download data.");
        }
        
        // Populate the UI and enable the button
        filenameEl.textContent = `sref_${sanitize(requestData.sref)}.zip`;
        downloadBtn.disabled = false;
        downloadBtn.addEventListener('click', handleDownloadClick);

    } catch (error) {
        showError(error.message);
    }
}

/**
 * Handles the click event on the download button. This is the trusted user gesture.
 */
async function handleDownloadClick() {
    if (!requestData) {
        showError("Download data is not available.");
        return;
    }

    // Update UI to show processing state
    downloadBtn.disabled = true;
    btnText.textContent = 'Zipping...';
    iconDownload.classList.add('hidden');
    iconSpinner.classList.remove('hidden');

    let blobUrl = null;

    try {
        const { sref, images, cover } = requestData;
        const { format } = await chrome.storage.sync.get({ format: 'original' });
        const zip = new JSZip();

        const fetchQueue = images.map(image => ({
            url: image.url, name: sanitize(image.name), type: 'image'
        }));
        fetchQueue.push({
            url: cover.dataUrl, name: sanitize(cover.name), type: 'cover'
        });

        // Fetch and process all images
        const imageBlobs = await Promise.all(fetchQueue.map(item => processItem(item, format)));

        for (const item of imageBlobs) {
            if (item) {
                zip.file(item.name, item.blob);
            }
        }
        
        btnText.textContent = 'Saving...';

        // Generate the blob with an explicit MIME type.
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/zip',
            compression: 'DEFLATE'
        });

        const fileName = `sref_${sanitize(sref)}.zip`;
        blobUrl = URL.createObjectURL(zipBlob);

        // --- Definitive Filename Fix using native browser download ---
        // The chrome.downloads API is unreliable for naming blob downloads from extension pages.
        // Using a temporary anchor link is the most robust method.
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName; // This attribute tells the browser to download the file with this name

        // Append to the document, click, and then remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // The download has been initiated. We can revoke the blob URL and update the UI.
        URL.revokeObjectURL(blobUrl);
        blobUrl = null; // prevent double-revocation in finally block

        btnText.textContent = 'Done!';
        iconDownload.classList.remove('hidden');
        iconSpinner.classList.add('hidden');

        // Close the helper tab after a short moment, giving the user time to see the status.
        setTimeout(() => {
            window.close();
        }, 1500);

    } catch (error) {
        console.error('MJ Style Saver: Download process failed.', error);
        showError(error.message, true); // Keep the window open to show the error
    } finally {
        if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
        }
    }
}

function showError(message, keepOpen = false) {
    filenameEl.textContent = 'Error';
    btnText.textContent = message;
    downloadBtn.disabled = true;
    iconDownload.classList.remove('hidden');
    iconSpinner.classList.add('hidden');
    if (!keepOpen) {
        setTimeout(() => window.close(), 4000);
    }
}

async function processItem(item, format) {
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
        return null; // Return null for failed items
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

// Start the process when the DOM is ready
document.addEventListener('DOMContentLoaded', init);