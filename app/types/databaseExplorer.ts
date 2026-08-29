export type DatabaseExplorerJump = {
  token: number;
  /** Prefill console (takes precedence over table). */
  querySql?: string;
  /** When set without querySql, open console with SELECT * preview for this table. */
  table?: string;
  dbTarget?: 'd1' | 'hyperdrive';
};
