/**
 * @file DatasourceChecker.cfc
 * @output false
 * @description Provides health-check diagnostics for configured Lucee datasources,
 *              evaluating availability concurrently and returning serialized JSON results.
 *
 * EXAMPLE JSON RETURN FORMAT:
 * [
 *     {
 *         "datasource": "ProductionDB_Primary",
 *         "available": true
 *     },
 *     {
 *         "datasource": "ProductionDB_Secondary",
 *         "available": false
 *     }
 * ]
 */
component displayname="DatasourceChecker" output="false" {

    /**
     * @hint Executes lightweight health diagnostic queries across all mapped datasources.
     * @return array Returns an array of structs containing datasource names and availability flags.
     *               Serialized automatically to JSON format upon remote return.
     */
    remote array function getStatus() returnformat="json" output="false" {

        // Define a key-value mapping where each key is an active Lucee datasource name
        // and the value is a low-overhead query string used to test connectivity.
        var datasourceMap = {
            "<DataSource1>": "<Limited SQL Statement>",
            ...
        };

        // Extract all datasource names from the map into an array for iterative processing.
        var dsKeys = structKeyArray(datasourceMap);

        // Iterate over the datasource keys to assess connection health.
        // The second parameter 'true' enables Lucee's native parallel thread execution,
        // allowing all datasource checks to run concurrently rather than sequentially.
        var results = dsKeys.map(function(dsn) {
            var sqlString = datasourceMap[dsn];
            var isAvailable = false;

            try {
                // Execute a tightly controlled validation query to probe datasource responsiveness.
                queryExecute(
                    sqlString,
                    {}, // No query parameters are needed for a basic connectivity test.
                    {
                        datasource: dsn,                             // Explicitly targets the current iteration's datasource.
                        maxrows: 1,                                  // Restricts result size to 1 row to optimize network and memory footprint.
                        timeout: 3,                                  // Fails fast by throwing an exception if the query takes longer than 3 seconds.
                        cachedwithin: createTimeSpan(0, 0, 0, 30)    // Caches health status for 30 seconds to prevent hammering the database on rapid requests.
                    }
                );

                // If queryExecute completes without throwing an exception, the datasource is operational.
                isAvailable = true;
            } catch (any e) {
                // Catch any connection drops, authentication failures, or timeouts and mark as unavailable.
                isAvailable = false;
            }

            // Construct and return a standardized result object for the current datasource.
            return {
                "datasource": dsn,
                "available": javaCast("boolean", isAvailable)
            };
        }, true); // Enables Lucee's high-performance concurrent thread pool mapping.

        // Return the aggregated array of health statuses, automatically serialized to JSON.
        return results;
    }
}