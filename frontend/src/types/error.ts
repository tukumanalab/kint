export interface ErrorResponse {
  code: string;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail?: any;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorResponse;

  constructor(status: number, body: ErrorResponse) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}
