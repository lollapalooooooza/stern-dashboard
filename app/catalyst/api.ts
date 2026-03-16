import axios from 'axios';

const baseURL = process.env.NEXT_PUBLIC_CATALYST_API_URL || '/catalyst-api';

export const catalystApi = axios.create({ baseURL });
