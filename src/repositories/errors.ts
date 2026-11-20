/** 仓储层统一错误：message 直接面向用户，页面可原样展示。 */
export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export class NotFoundError extends RepositoryError {
  constructor(what: string) {
    super(`${what}不存在，可能已被删除。`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends RepositoryError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends RepositoryError {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
