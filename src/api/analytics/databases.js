/**
 * Compatibility facade — dual-lane analytics databases API.
 * Implementation: ./databases/index.js
 */
export {
  parseDatabasesRange,
  parseDatabasesDs,
  parseDatabasesSurface,
  handleDatabasesSummary,
  handleDatabasesQueries,
  handleDatabasesTables,
  handleDatabasesTimeseries,
  handleDatabasesEvents,
  handleDatabasesOverview,
} from './databases/index.js';
