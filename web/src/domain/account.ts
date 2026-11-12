import type { Profile } from '../api/types';

export const ADMIN_NAME = '관리자';
export const ADMIN_POSITION = '기획처';

export function accountLabel(profile: { name: string; position: string }): string {
  return `${profile.position}. ${profile.name}`;
}

export function isAdminAccount(profile: Profile): boolean {
  return (
    profile.role === 'admin' &&
    profile.name === ADMIN_NAME &&
    profile.position === ADMIN_POSITION &&
    !profile.officerId &&
    !profile.savedEmail
  );
}

export function asAdminAccount(profile: Profile, auth?: { adminToken?: string; adminTokenExp?: number }): Profile {
  return {
    deviceId: profile.deviceId,
    name: ADMIN_NAME,
    position: ADMIN_POSITION,
    role: 'admin',
    mustChangePassword: profile.mustChangePassword,
    adminToken: auth?.adminToken ?? profile.adminToken,
    adminTokenExp: auth?.adminTokenExp ?? profile.adminTokenExp,
    createdAt: profile.createdAt,
    registeredAt: profile.registeredAt,
  };
}
