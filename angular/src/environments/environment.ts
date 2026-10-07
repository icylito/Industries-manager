// Where the API is. The page on https (start.bat https) talks to the https profile of the API, otherwise the plain http one.
// Change the ports here if the API runs somewhere else.
const secure = typeof location !== 'undefined' && location.protocol === 'https:';

export const environment = {
  apiUrl: secure ? 'https://localhost:7165' : 'http://localhost:5005',
};
