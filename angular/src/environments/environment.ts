// Where the API is. The page on https (start.bat https) talks to the https profile of the API, otherwise the plain http one.
// Opened from another device (start.bat share), the page server passes /api on to the API, see proxy.share.json.
// Change the ports here if the API runs somewhere else.
const secure = typeof location !== 'undefined' && location.protocol === 'https:';
const local = typeof location === 'undefined' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export const environment = {
  apiUrl: !local ? '/api' : secure ? 'https://localhost:7165' : 'http://localhost:5005',
};
