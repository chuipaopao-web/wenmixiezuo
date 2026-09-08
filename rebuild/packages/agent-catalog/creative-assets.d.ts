export interface CreativeProfile {version:string;scale:number;styles:string[];workType:'novel'}
export const CREATIVE_ASSET_VERSION:string;
export const CREATIVE_ASSETS:readonly {id:string;category:string;name:string;summary:string}[];
export const CREATIVE_SCALES:readonly {level:number;name:string;description:string}[];
export const READING_STYLES:readonly string[];
export function normalizeCreativeProfile(value?:unknown):CreativeProfile;
export function creativeDirective(profile:CreativeProfile | undefined | null,stage?:string):Record<string,unknown> | null;
export function openingCreativeCatalog():string[][];
