/** Supabase Storage の唯一のバケット名 */
export const STORAGE_BUCKET = "question-images" as const;

/** ストレージパス生成ヘルパー */
export const storagePaths = {
  /** 設問画像: questions/{questionId}/{filename} */
  question: (questionId: string, filename: string) =>
    `questions/${questionId}/${filename}`,

  /** 回答画像: respondents/{sessionId}/{filename} */
  respondent: (sessionId: string, filename: string) =>
    `respondents/${sessionId}/${filename}`,

  /** 投稿画像: posts/{postId}/{filename} */
  post: (postId: string, filename: string) =>
    `posts/${postId}/${filename}`,
} as const;
