export class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

export async function apiRequest(path, { body, headers, ...options } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/')) {
        throw new TypeError('API path phải là URL tương đối bắt đầu bằng /api/.');
    }

    const requestHeaders = new Headers(headers);
    requestHeaders.set('Accept', 'application/json');
    if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');

    let response;
    try {
        response = await fetch(path, {
            ...options,
            headers: requestHeaders,
            credentials: 'same-origin',
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (error) {
        throw new ApiError('Không thể kết nối máy chủ. Kiểm tra kết nối mạng rồi thử lại.', 0, error);
    }

    let data = null;
    if (response.status !== 204) {
        const responseText = await response.text();
        if (responseText) {
            if (response.headers.get('content-type')?.includes('application/json')) {
                try {
                    data = JSON.parse(responseText);
                } catch {
                    throw new ApiError('Phản hồi JSON từ máy chủ không hợp lệ.', response.status, responseText);
                }
            } else {
                data = responseText;
            }
        }
    }

    if (!response.ok) {
        const message = typeof data === 'string'
            ? data
            : data?.error || data?.message || `Yêu cầu thất bại (HTTP ${response.status}).`;
        throw new ApiError(message, response.status, data);
    }

    return data;
}