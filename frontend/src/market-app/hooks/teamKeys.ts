/** Every team list and mutation shares this prefix: a save refetches bazaars and sellers. */
export const TEAM_KEY: readonly string[] = ['market', 'team'];

/** A team is small; one page holds it all. */
export const TEAM_PAGE = { params: { page_size: 200 } };
