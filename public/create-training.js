// === ДОБАВЛЯЮ ФУНКЦИЮ ДЛЯ ПОЛУЧЕНИЯ ТОКЕНА И ОБЕРТКУ ДЛЯ fetch ===
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
        const token = getCookie('adminToken');
        if (token) {
            options.headers = options.headers || {};
            if (options.headers instanceof Headers) {
                const headersObj = {};
                options.headers.forEach((v, k) => { headersObj[k] = v; });
                options.headers = headersObj;
            }
            options.headers['Authorization'] = `Bearer ${token}`;
        }
    }
    return originalFetch(url, options);
}; 