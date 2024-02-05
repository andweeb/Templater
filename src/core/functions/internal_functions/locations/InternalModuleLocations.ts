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

export class InternalModuleLocations extends InternalModule {
    name: ModuleName = "locations";

    async create_dynamic_templates(): Promise<void> {
        // required on InternalModule but unnecessary
    }

    async create_static_templates(): Promise<void> {
        this.static_functions.set("search_place", this.generate_place_search());
        this.static_functions.set("search_yelp", this.generate_yelp_search());
    }

    // Public API to retrieve Yelp information using system commands
    generate_place_search(): (tp: any) => Promise<Place> {
        return async (tp: any): Promise<Place | null> => {
            if (!this.plugin.settings.google_api_key) {
                throw new TemplaterError('Google API key was not found');
            }

            // Fetch Yelp search result
            const yelpResults = await this.generate_yelp_search()(tp);
            if (yelpResults === null) return // Aborted search
            if (!yelpResults.length) {
                new tp.obsidian.Notice('Failed to find Yelp business results');
                return;
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
            const google_place_details = await this.fetch_google_place_details(google_place_id);
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
                summary,
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
    generate_yelp_search(): (tp: any) => Promise<YelpBusiness[]> {
        return async (tp: any): Promise<YelpBusiness[] | null> => {
            const name = await tp.system.prompt("Enter business name");
            if (!name) {
                return null;
            }

            const city = await tp.system.suggester(cities, cities, false, "Select a city", 10)
            if (!city) {
                return null;
            }

            if (!this.plugin.settings.yelp_api_key) {
                throw new TemplaterError('Yelp API key was not found');
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
        const request = new Request(`${cors_proxy_url}/https://api.yelp.com/v3/graphql`, {
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
        return Object.values(data).reduce((acc, data) => [...acc, ...data.business], []);
    }

    // -------------------------------------------------------------------------------- 
    // Google API
    private async search_google_place(name: string, latitude: number, longitude: number): Promise<any> {
        const { cors_proxy_url, google_api_key } = this.plugin.settings;
        const params = new URLSearchParams({
            input: name,
            inputtype: 'textquery',
            locationbias: `point:${latitude},${longitude}`,
            key: google_api_key,
        });
        const url = `${cors_proxy_url}/https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`;

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

    private async fetch_google_place_details(place_id: string): Promise<GooglePlaceDetails> {
        const { cors_proxy_url, google_api_key } = this.plugin.settings;
        const params = new URLSearchParams({
            fields: 'name,editorial_summary,formatted_address,photos,rating,url,user_ratings_total,website',
            key: google_api_key,
            place_id,
        });
        const url = `${cors_proxy_url}/https://maps.googleapis.com/maps/api/place/details/json?${params}`;

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
