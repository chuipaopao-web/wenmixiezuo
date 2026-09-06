export type RoleKey = 'chief_editor'|'deputy_editor'|'planning_writer'|'lead_writer'|'independent_reviewer'|'continuity_editor'|'visual_renderer';
export interface CatalogModel { readonly profileKey: string; readonly publicName: string; readonly kind: 'text'|'image' }
export interface CatalogRole { readonly roleKey: RoleKey; readonly departmentName: string; readonly publicName: string; readonly publicResponsibility: string; readonly kind: 'text'|'image'; readonly capacity: number }
export interface MemberSlot { readonly memberKey: string; readonly displayName: string; readonly roleKey: RoleKey; readonly initialModelProfileKey: string|null; readonly legacy: boolean; readonly avatarPath: string; readonly avatarSize: string; readonly avatarPosition: string }
export const TEXT_MODELS: readonly CatalogModel[];
export const IMAGE_MODELS: readonly CatalogModel[];
export const ROLES: readonly CatalogRole[];
export const MEMBER_SLOTS: readonly MemberSlot[];
export const V7_MEMBER_IDENTITIES: readonly (readonly [string,string])[];
export const V7_MEMBER_AVATAR_SPRITE: string;
export const V7_MEMBER_AVATAR_SIZE: string;
export function publicMemberIdentity(memberKey: string): MemberSlot|undefined;
export function candidateModels(roleKey: string): readonly CatalogModel[];
