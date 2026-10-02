import { ApiError } from '../../shared/api/client.js';

export function handleAdminAuthorizationError(error, onSessionExpired) {
    if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) return false;
    onSessionExpired(error.status === 401 ? 'login' : 'forbidden');
    return true;
}