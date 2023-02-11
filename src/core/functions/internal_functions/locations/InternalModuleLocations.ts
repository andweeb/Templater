import { TemplaterError } from "utils/Error";
import { InternalModule } from "../InternalModule";
import { ModuleName } from "editor/TpDocumentation";
import cities from "./Cities.json";

interface YelpSearch {
    name: string;
}

interface YelpCoordinateSearch extends YelpSearch {
    longitude: number;
    latitude: number;
}

interface YelpCityBasedSearch extends YelpSearch {
    city: string;
}

interface YelpBusiness {
    review_count:  number;
    categories:    Category[];
    id:            string;
    is_closed:     boolean;
    phone:         string;
    rating:        number;
    image_url:     string;
    url:           string;
    display_phone: string;
    price:         string;
    location:      Location;
    alias:         string;
    coordinates:   Coordinates;
    transactions:  string[];
    distance:      number;
    photos:        string[];
    name:          string;
}

interface GooglePlaceDetails {
    editorial_summary: {
        overview?: string;
    };
    formatted_address: string;
    name: string;
    photos: string;
    rating: number;
    url: string;
    user_ratings_total: number;
    website: string;
    [key: string]: any;
}
interface GooglePlace {
    name: string;
    summary: string;
    address: string;
    website: string;
    categories: string[]
    url: string;
    review_count: number;
    ratings: string;
}

interface Category {
    alias: string;
    title: string;
}

interface Coordinates {
    longitude: number;
    latitude:  number;
}
interface Location {
    address2:        string;
    city:            string;
    country:         string;
    zip_code:        string;
    address1:        string;
    address3:        string;
    state:           string;
    display_address: string[];
}

interface Place {
    name: string;
    summary: string;
    address: string;
    location: Location;
    website: string;
    categories: string;
    banner: string;
    yelp_url: string;
    yelp_review_count: number;
    yelp_ratings: string;
    google_url: string;
    google_review_count: number;
    google_ratings: string;
}

type YelpSearchInput = YelpCoordinateSearch | YelpCityBasedSearch;

const YELP_API_URL = 'https://api.yelp.com/v3/graphql';
const GOOGLE_PLACES_API_BASE_URL = 'https://maps.googleapis.com/maps/api/place';
const GOOGLE_PLACES_PLACE_URL = `${GOOGLE_PLACES_API_BASE_URL}/findplacefromtext/json`;
const GOOGLE_PLACES_PLACE_DETAILS_URL = `${GOOGLE_PLACES_API_BASE_URL}/details/json`;

const DEFAULT_GOOGLE_DETAILS = [
    'name',
    'editorial_summary',
    'formatted_address',
    'photos',
    'rating',
    'url',
    'user_ratings_total',
    'website'
];


export class InternalModuleLocations extends InternalModule {
    name: ModuleName = "locations";

    async create_dynamic_templates(): Promise<void> {
        // required on InternalModule but unnecessary
    }

    async create_static_templates(): Promise<void> {
        this.static_functions.set("search_place", this.generate_place_search());
        this.static_functions.set("search_yelp", this.generate_yelp_search());
        this.static_functions.set("search_google_places", this.generate_google_places_search());
    }

    // Public API to retrieve both Google Places and Yelp information using system commands
    generate_place_search(): (tp: any) => Promise<Place | null> {
        return async (tp: any): Promise<Place | null> => {
            if (!this.plugin.settings.google_api_key) {
                throw new TemplaterError('Google API key was not found');
            }

            // Fetch Yelp search result
            const yelpResults = await this.generate_yelp_search()(tp);
            console.log('yelpResults', yelpResults);

            // Aborted search
            if (yelpResults === null) {
                return null;
            }
            if (!yelpResults.length) {
                new tp.obsidian.Notice('Failed to find Yelp business results');
                return null;
            }
            const [business] = yelpResults;

            // Define template variables
            const name = business.name;
            const [yelp_url] = business.url.split('?');
            const yelp_review_count = business.review_count;
            const categories = business.categories.map(category => category.alias).join('\n  - ');
            const [banner] = business.photos;
            const location = business.location;

            // Create yelp rating stars text
            const rounded_yelp_rating = Math.ceil(business.rating);
            const yelp_stars = [...this.make_stars(rounded_yelp_rating, '★'), ...this.make_stars(5 - rounded_yelp_rating, '☆')]
            const yelp_ratings = yelp_stars.join('')

            // Fetch Google Place and Place Detail search result
            const { latitude, longitude } = business.coordinates;
            const google_place_id = await this.search_google_place(name, latitude, longitude);
            console.log('google_place_id', google_place_id);
            const google_place_details = await this.fetch_google_place_details(google_place_id);
            console.log('google_place_details', google_place_details);
            const summary = google_place_details.editorial_summary ? google_place_details.editorial_summary.overview : '';
            const address = google_place_details.formatted_address;
            const website = google_place_details.website || '';
            const google_url = google_place_details.url;
            const google_review_count = google_place_details.user_ratings_total;

            // Create google rating stars text
            const rounded_google_rating = Math.ceil(google_place_details.rating);
            const google_stars = [...this.make_stars(rounded_google_rating, '★'), ...this.make_stars(5 - rounded_google_rating, '☆')]
            const google_ratings = google_stars.join('')

            return {
                name,
                summary: summary || '',
                address,
                website,
                location,
                categories,
                banner,
                yelp_url,
                yelp_review_count,
                yelp_ratings,
                google_url,
                google_review_count,
                google_ratings,
            };
        };
    }

    // Public API to retrieve Google Place information using system commands
    generate_google_places_search(): (tp: any) => Promise<GooglePlace | null> {
        return async (tp: any): Promise<GooglePlace | null> => {
            if (!this.plugin.settings.google_api_key) {
                throw new TemplaterError('Google API key was not found');
            }

            const name = await tp.system.prompt("Enter business name");
            if (!name) {
                return null;
            }

            const city = await tp.system.suggester(cities, cities, false, "Select a city", 10)
            if (!city) {
                return null;
            }

            // Fetch Google Place and Place Detail search result
            const text = `${name} ${city}`;
            const details = [...DEFAULT_GOOGLE_DETAILS, 'address_components', 'types'];
            const google_place_id = await this.search_google_place(text);
            const google_place_details = await this.fetch_google_place_details(google_place_id, details);
            const summary = google_place_details.editorial_summary ? google_place_details.editorial_summary.overview : '';
            const address = google_place_details.formatted_address;
            const website = google_place_details.website || '';
            const url = google_place_details.url;
            const review_count = google_place_details.user_ratings_total;
            const categories = google_place_details.types
                ? google_place_details.types.join('\n  - ')
                : '';

            // Create google rating stars text
            const rounded_google_rating = Math.ceil(google_place_details.rating);
            const google_stars = [...this.make_stars(rounded_google_rating, '★'), ...this.make_stars(5 - rounded_google_rating, '☆')]
            const ratings = google_stars.join('')

            return {
                name,
                summary: summary || '',
                address,
                website,
                categories,
                url,
                review_count,
                ratings,
            };
        };
    }

    // -------------------------------------------------------------------------------- 
    // Yelp API
    make_stars = (num: number, star: string): string[] =>  new Array(num).fill(star);

    stripSpecials(str: string): string {
        return str.replace(/[^a-zA-Z0-9]/g, '');
    }

    create_yelp_search_block(input: YelpSearchInput): string {
        const queryName = this.stripSpecials(input.name);

        let params = '';

        if ('city' in input) {
            params = `location: "${input.city}"`;
        } else {
            params = `latitude: ${input.latitude}, longitude: ${input.longitude}`;
        }

        return `
    search${queryName}: search(term: "${input.name}", limit: 1, ${params}) {
        business {
            name
            url
            photos
            rating
            review_count
            coordinates {
              longitude
              latitude
            }
            location {
                address1
                address2
                address3
                city
                state
                country
            }
            categories {
                alias
            }
        }
    }`;
    }

    generate_yelp_query(search_inputs: YelpSearchInput[]): string {
    return `query {
${search_inputs.map((input) => this.create_yelp_search_block(input)).join('\n')}
}`;
    }

    // Public API to retrieve Yelp information using system commands
    generate_yelp_search(): (tp: any) => Promise<YelpBusiness[] | null> {
        return async (tp: any): Promise<YelpBusiness[] | null> => {
            if (!this.plugin.settings.yelp_api_key) {
                throw new TemplaterError('Yelp API key was not found');
            }

            const name = await tp.system.prompt("Enter business name");
            if (!name) {
                return null;
            }

            const city = await tp.system.suggester(cities, cities, false, "Select a city", 10)
            if (!city) {
                return null;
            }

            const response = await this.search_yelp([ { name, city } ]);

            return response;
        }
    }

    private async search_yelp(search_inputs: YelpSearchInput[]): Promise<YelpBusiness[]> {
        if (!search_inputs || !search_inputs.length) {
            throw new TemplaterError('No search inputs provided');
        }

        const query = this.generate_yelp_query(search_inputs);

        const { cors_proxy_url, yelp_api_key } = this.plugin.settings;
        const request = new Request(`${cors_proxy_url}/${YELP_API_URL}`, {
            method: 'POST',
            body: JSON.stringify({ query }),
            headers: new Headers({
                Authorization: `Bearer ${yelp_api_key}`,
                'Content-Type': 'application/json',
                'Accept-Language': 'en_US',
            }),
        });

        // Make the request
        const response = await fetch(request);

        type JSONResponse = {
            data?: {
                [searchName: string]: {
                    business: YelpBusiness[],
                }
            }
            errors?: Array<{message: string}>
        }
        const { data, errors }: JSONResponse = await response.json();

        if (!response.ok) {
            throw new TemplaterError(errors?.map(e => e.message).join('\n') ?? 'unknown');
        }

        // Normalize results into businesses list
        // @ts-ignore
        return Object.values(data).reduce((acc, data) => [...acc, ...data.business], []);
    }

    // -------------------------------------------------------------------------------- 
    // Google API
    private async search_google_place(name: string, latitude?: number, longitude?: number): Promise<any> {
        const { cors_proxy_url, google_api_key } = this.plugin.settings;
        const parameterMap = new Map<string, string>([
            ['input', name],
            ['inputtype', 'textquery'],
            ['key', google_api_key],
        ]);

        // Add coordinate location bias if provided
        if (latitude && longitude) {
            parameterMap.set('locationbias', `point:${latitude},${longitude}`);
        }

        // Construct URL from input parameters
        const params = new URLSearchParams(Object.fromEntries(parameterMap));
        const url = `${cors_proxy_url}/${GOOGLE_PLACES_PLACE_URL}?${params}`;

        const request = new Request(url);
        const response = await fetch(request, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            }
        });

        const { status, candidates, errors } = await response.json();
        if (status !== 'OK') {
            throw new TemplaterError(errors?.map((e: any) => e.message).join('\n') ?? 'unknown');
        }
        if (!candidates.length) {
            throw new TemplaterError('Found no Google place results');
        }

        const [candidate] = candidates;

        return candidate.place_id;
    }

    private async fetch_google_place_details(
        place_id: string,
        details: string[] = DEFAULT_GOOGLE_DETAILS,
    ): Promise<GooglePlaceDetails> {
        const { cors_proxy_url, google_api_key } = this.plugin.settings;
        const params = new URLSearchParams({
            fields: details.join(','),
            key: google_api_key,
            place_id,
        });
        const url = `${cors_proxy_url}/${GOOGLE_PLACES_PLACE_DETAILS_URL}?${params}`;

        const request = new Request(url);

        const response = await fetch(request, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            }
        });

        const { status, errors, result } = await response.json();
        if (status !== 'OK') {
            throw new TemplaterError(errors?.map((e: any) => e.message).join('\n') ?? 'unknown');
        }
        if (!result) {
            throw new TemplaterError('Found no Google place details');
        }

        return result;
    }
}
