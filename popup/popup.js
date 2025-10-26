document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const themeIconLight = document.getElementById('theme-icon-light');
    const themeIconDark = document.getElementById('theme-icon-dark');
    const formatRadios = document.querySelectorAll('input[name="image-format"]');
    const storageMethodRadios = document.querySelectorAll('input[name="storage-method"]');

    const defaults = {
        theme: 'system',
        format: 'original',
        storageMethod: 'auto' // 'auto' or 'prompt'
    };

    // Function to apply theme
    const applyTheme = (theme) => {
        if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
            themeIconLight.classList.remove('hidden');
            themeIconDark.classList.add('hidden');
        } else {
            document.documentElement.classList.remove('dark');
            themeIconLight.classList.add('hidden');
            themeIconDark.classList.remove('hidden');
        }
    };

    // Load settings from storage
    chrome.storage.sync.get(defaults, (settings) => {
        // Apply theme
        applyTheme(settings.theme);
        
        // Set UI elements
        document.querySelector(`input[name="image-format"][value="${settings.format}"]`).checked = true;
        document.querySelector(`input[name="storage-method"][value="${settings.storageMethod}"]`).checked = true;
    });

    // Theme toggle logic
    themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.classList.contains('dark');
        const newTheme = isDark ? 'light' : 'dark';
        chrome.storage.sync.set({ theme: newTheme }, () => {
            applyTheme(newTheme);
        });
    });

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
       chrome.storage.sync.get({ theme: 'system' }, (settings) => {
           if(settings.theme === 'system') {
               applyTheme('system');
           }
       });
    });

    // Save format setting on change
    formatRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            chrome.storage.sync.set({ format: e.target.value });
        });
    });

    // Save storage method setting on change
    storageMethodRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                chrome.storage.sync.set({ storageMethod: e.target.value });
            }
        });
    });
});