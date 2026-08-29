/**
 * Vectorize is a rebuildable projection, not memory SSOT.
 *
 * This adapter exists so a later swap does not leak into MemoryService.
 * Writes fail loud. Search is unimplemented until a projection builder exists.
 */
export class VectorizeMemoryStore {
  constructor() {
    this.kind = 'vectorize_projection';
  }

  async insert() {
    throw new Error('vectorize_is_projection_not_ssot');
  }

  async getById() {
    throw new Error('vectorize_is_projection_not_ssot');
  }

  async search() {
    throw new Error('vectorize_projection_search_not_wired');
  }

  async list() {
    throw new Error('vectorize_is_projection_not_ssot');
  }

  async update() {
    throw new Error('vectorize_is_projection_not_ssot');
  }

  async softDelete() {
    throw new Error('vectorize_is_projection_not_ssot');
  }
}
