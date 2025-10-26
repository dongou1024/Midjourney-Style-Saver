// This service worker's only job is to handle "Ask where to save" requests
// by opening a helper page. "Save automatically" is now handled entirely
// by the content script for better reliability.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download_style') {
        // This listener now only receives requests for the 'prompt' storage method.
        handlePromptDownload(request)
            .then(() => sendResponse({ success: true }))
            .catch(error => {
                console.error('MJ Style Saver Error (Prompt Setup):', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Indicates an asynchronous response will be sent.
    }
});

/**
 * Handles the "Ask where to save" method by creating a unique ID for the
 * download data, storing it, and opening a visible helper tab that will
 * retrieve and process this data.
 * @param {object} request The download request data from the content script.
 */
async function handlePromptDownload(request) {
    // Create a unique key to store the data for this specific download.
    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    
    // Store the data in local storage, which the helper page can access.
    await chrome.storage.local.set({ [downloadId]: request });

    // Open the helper page in a new, active tab.
    await chrome.tabs.create({
        url: chrome.runtime.getURL(`download/download.html?id=${downloadId}`),
        active: true
    });
}