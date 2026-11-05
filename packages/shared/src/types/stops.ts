/** One match from `GET /{region}/stops/find-stop/{q}` - a lighter record for autocomplete than the full `Stop`. */
export interface StopSearchResult {
    name: string
    /** "bus" | "train" | "ferry" | "other" */
    type_of_stop: string
    stop_lat: number
    stop_lon: number
    stop_code: string
    stop_id: string
}
