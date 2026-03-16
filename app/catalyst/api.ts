import axios from 'axios';
export const catalystApi = axios.create({ baseURL: '/catalyst-api' });
