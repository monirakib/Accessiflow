// AccessiFlow — Background Service Worker (MV3)
// Relays messages between popup and content scripts
'use strict';

// Relay messages between popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === 'relayToContent') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, message.data, (response) => {
            sendResponse(response || { success: true });
          });
        } else {
          sendResponse({ error: 'No active tab found' });
        }
      });
      return true; // async
    }

    if (message.action === 'relayToPopup') {
      chrome.runtime.sendMessage(message.data);
      sendResponse({ success: true });
    }

    if (message.action === 'getActiveTab') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse(tabs[0] || null);
      });
      return true;
    }
  } catch (e) {
    console.warn('[AccessiFlow][BG] Error:', e.message);
    sendResponse({ error: e.message });
  }
});

// On install, open welcome page
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'welcome.html' });
  }
});
