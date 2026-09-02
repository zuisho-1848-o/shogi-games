import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4はasyncなルートハンドラの中で投げられた例外(rejectしたPromise)を自動では拾ってくれない。
 * 素のままだとDBエラー等でunhandled rejectionが発生し、Node.jsのデフォルト挙動でプロセス全体が
 * クラッシュしてしまう(進行中の全リクエストが巻き添えになる)。このラッパーで包むことで、
 * 例外を`next(err)`経由でExpressのエラーハンドラ(index.tsのグローバルエラーミドルウェア)に渡す。
 */
export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };
