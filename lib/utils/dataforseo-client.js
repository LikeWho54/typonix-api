/**
 * DataForSEO API Client Utility
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;

// API URLs
const DATAFORSEO_MAPS_API_URL = 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced';
const DATAFORSEO_COMPETITORS_API_URL = 'https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live';
const DATAFORSEO_DOMAIN_INTERSECTION_URL = 'https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live';

/**
 * Call DataForSEO Google Maps API
 * @param {Array} tasks - Array of task objects
 * @returns {Promise<Object>} - API response
 */
async function callDataForSEOMaps(tasks) {
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');

  console.log(`📡 Calling DataForSEO Google Maps API with ${tasks.length} task(s)...`);

  const response = await fetch(DATAFORSEO_MAPS_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(tasks)
  });

  if (!response.ok) {
    throw new Error(`DataForSEO Maps API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO Maps API returned status: ${data.status_code} - ${data.status_message}`);
  }

  console.log(`✅ DataForSEO Maps API call successful. Cost: $${data.cost}`);
  return data;
}

/**
 * Call DataForSEO Competitors Domain API
 * @param {string} target - Domain to analyze
 * @param {number} locationCode - Location code
 * @param {string} languageCode - Language code
 * @param {number} limit - Number of competitors to return
 * @returns {Promise<Object>} - API response
 */
async function callCompetitorsDomain(target, locationCode, languageCode, limit = 100) {
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');

  const task = [{
    target,
    location_code: locationCode,
    language_code: languageCode,
    limit,
    item_types: ['organic']
  }];

  console.log(`📡 Calling Competitors Domain API with params:`, {
    target,
    locationCode,
    languageCode,
    limit
  });

  const response = await fetch(DATAFORSEO_COMPETITORS_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(task)
  });

  if (!response.ok) {
    throw new Error(`DataForSEO Competitors API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO Competitors API returned status: ${data.status_code} - ${data.status_message}`);
  }

  console.log(`✅ Competitors Domain API call successful. Cost: $${data.cost}`);
  console.log(`📊 API Response structure:`, {
    tasksCount: data.tasks?.length,
    resultExists: !!data.tasks?.[0]?.result,
    resultLength: data.tasks?.[0]?.result?.length,
    itemsCount: data.tasks?.[0]?.result?.[0]?.items?.length || 0
  });

  return data;
}

/**
 * Call DataForSEO Domain Intersection API
 * @param {string} target1 - First domain
 * @param {string} target2 - Second domain
 * @param {number} locationCode - Location code
 * @param {string} languageCode - Language code
 * @param {boolean} intersections - True for shared keywords, false for unique
 * @returns {Promise<Object>} - API response
 */
async function callDomainIntersection(target1, target2, locationCode, languageCode, intersections) {
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');

  const task = [{
    target1,
    target2,
    location_code: locationCode,
    language_code: languageCode,
    include_serp_info: true,
    intersections,
    limit: 500
  }];

  const mode = intersections ? 'shared' : 'unique';
  console.log(`📡 Calling Domain Intersection API (${mode}): ${target1} vs ${target2}...`);

  const response = await fetch(DATAFORSEO_DOMAIN_INTERSECTION_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(task)
  });

  if (!response.ok) {
    throw new Error(`DataForSEO Domain Intersection API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO Domain Intersection API returned status: ${data.status_code} - ${data.status_message}`);
  }

  console.log(`✅ Domain Intersection API call successful (${mode}). Cost: $${data.cost}`);
  return data;
}

/**
 * Map country code to DataForSEO location code
 * @param {string} countryCode - ISO country code
 * @returns {number} - Location code
 */
function getLocationCode(countryCode) {
  const locationCodeMap = {
    US: 2840, // United States
    GB: 2826, // United Kingdom
    CA: 2124, // Canada
    AU: 2036, // Australia
    DE: 2276, // Germany
    FR: 2250, // France
    ES: 2724, // Spain
    IT: 2380, // Italy
  };

  return locationCodeMap[countryCode] || 2840; // Default to US
}

module.exports = {
  callDataForSEOMaps,
  callCompetitorsDomain,
  callDomainIntersection,
  getLocationCode
};
