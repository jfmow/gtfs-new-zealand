export interface ShapesResponse {
    color: string
    geojson: GeoJSON
}


export interface GeoJSON {
    type: "FeatureCollection"; // Specify this as a fixed value
    features: Feature[];
}

export interface Feature {
    type: "Feature";
    properties: Properties;
    geometry: Geometry;
}

export interface Geometry {
    type: "LineString" | "Polygon" | "MultiPolygon" | "Point"; // Add more types if needed
    coordinates: Array<Array<number[]>>;
}

export interface Properties {
    AGENCYNAME: string;
    MODE: string;
    OBJECTID: number;
    ROUTENAME: string;
    ROUTENUMBER: string;
    ROUTEPATTERN: string;
    Shape__Length: number;
}