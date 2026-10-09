// failoverService.ts

import { HttpClient, HttpClientResponse, IHttpClientOptions } from "@microsoft/sp-http";

export interface WebServices {
  ServerURL: string;
  AppKey: string;
  AppToken: string;
  DataSource: string;
  WriteAccess: boolean;
  sortIdx: number;
  uniqueId: string;
  checkerPath?: string; // Required unless provided globally via options
}

interface IDataSourceStatus {
  datasource: string;
  available: boolean;
}

export type AvailabilityCheck = (service: WebServices, httpClient: HttpClient, defaultPath?: string) => Promise<boolean>;

export type FailoverStage = "webService" | "dataSource";

export interface IFailoverAttempt {
  uniqueId: string;
  stage: FailoverStage;
  reason: string;
}

export interface IFailoverOptions {
  requireWriteAccess?: boolean;
  timeoutMs?: number;
  userDisplayName?: string;
  defaultCheckerPath?: string; // Global fallback checker path
}

export class FailoverError extends Error {
  public readonly attempts: ReadonlyArray<IFailoverAttempt>;

  public constructor(message: string, attempts: IFailoverAttempt[]) {
    super(message);
    this.name = "FailoverError";
    this.attempts = attempts.slice();
    Object.setPrototypeOf(this, FailoverError.prototype);
  }
}

export default class FailoverService {
  public constructor(
    private readonly httpClient: HttpClient,
    private readonly checkDataSource: AvailabilityCheck = (s, hc, dp) => defaultCheckDataSource(hc, s, dp),
    private readonly defaultCheckerPath?: string
  ) {}

  public static async resolveFromConfig(
    httpClient: HttpClient,
    jsonConfig?: string,
    options: IFailoverOptions = {},
    customDataSourceCheck?: AvailabilityCheck
  ): Promise<WebServices> {
    const serviceList = FailoverService.parseConfigString(jsonConfig);
    const serviceInstance = new FailoverService(httpClient, customDataSourceCheck, options.defaultCheckerPath);
    return serviceInstance.resolveAvailableWebService(serviceList, options);
  }

  public static parseConfigString(jsonConfig?: string): WebServices[] {
    if (!jsonConfig || !jsonConfig.trim()) {
      throw new Error("No web service configuration provided.");
    }
    try {
      const parsed = JSON.parse(jsonConfig);
      if (!Array.isArray(parsed)) {
        throw new Error("Configuration JSON must be an array of WebServices.");
      }
      return parsed;
    } catch (e) {
      throw new Error(`Invalid JSON format in Web Services configuration: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  public async resolveAvailableWebService(
    webServices: ReadonlyArray<WebServices>,
    options: IFailoverOptions = {}
  ): Promise<WebServices> {
    const timeoutMs = options.timeoutMs === undefined ? 10000 : options.timeoutMs;
    const globalDefaultPath = options.defaultCheckerPath || this.defaultCheckerPath;

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive, finite number.");
    }

    const candidates = webServices
      .map((service, index) => ({ service, index }))
      .filter(({ service }) => !options.requireWriteAccess || service.WriteAccess)
      .sort((a, b) => a.service.sortIdx - b.service.sortIdx || a.index - b.index);

    if (candidates.length === 0) {
      throw new FailoverError("No eligible web service configurations were provided.", []);
    }

    const attempts: IFailoverAttempt[] = [];

    for (const candidate of candidates) {
      const service = candidate.service;
      let stage: FailoverStage = "webService";

      try {
        const serverAvailable = await this.runCheck(
          () => this.checkWebService(service, options.userDisplayName, globalDefaultPath),
          timeoutMs
        );

        if (!serverAvailable) {
          attempts.push({
            uniqueId: service.uniqueId,
            stage,
            reason: "Web service availability check returned false."
          });
          continue;
        }

        stage = "dataSource";
        const dataSourceAvailable = await this.runCheck(
          () => this.checkDataSource(service, this.httpClient, globalDefaultPath),
          timeoutMs
        );

        if (!dataSourceAvailable) {
          attempts.push({
            uniqueId: service.uniqueId,
            stage,
            reason: `Data source '${service.DataSource}' is not available or missing.`
          });
          continue;
        }

        return service;
      } catch (error) {
        attempts.push({
          uniqueId: service.uniqueId,
          stage,
          reason: error instanceof Error ? error.message : "Availability check failed."
        });
      }
    }

    throw new FailoverError("All eligible web services or data sources failed their checks.", attempts);
  }

  private getCheckerUrl(service: WebServices, defaultPath?: string): string {
    const baseUrl = service.ServerURL.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("ServerURL is required.");
    }

    const relativePath = service.checkerPath || defaultPath;
    if (!relativePath) {
      throw new Error(`No checkerPath specified for service '${service.uniqueId}' and no defaultCheckerPath provided.`);
    }

    const formattedPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
    return `${baseUrl}${formattedPath}`;
  }

  private async checkWebService(service: WebServices, userDisplayName?: string, defaultPath?: string): Promise<boolean> {
    const url = this.getCheckerUrl(service, defaultPath);
    const payload = {
      AppKey: service.AppKey,
      AppToken: service.AppToken,
      User: userDisplayName || "System"
    };

    const httpClientOptions: IHttpClientOptions = {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json"
      }
    };

    const response = await this.httpClient.post(url, HttpClient.configurations.v1, httpClientOptions);

    if (!response.ok) {
      throw new Error(`Web service check failed with HTTP ${response.status}.`);
    }

    return true;
  }

  private runCheck(
    check: () => Promise<boolean>,
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Availability check timed out after ${timeoutMs} ms.`));
      }, timeoutMs);

      Promise.resolve()
        .then(check)
        .then(
          result => {
            clearTimeout(timer);
            resolve(result);
          },
          error => {
            clearTimeout(timer);
            reject(error);
          }
        );
    });
  }
}

async function defaultCheckDataSource(
  httpClient: HttpClient,
  service: WebServices,
  defaultPath?: string
): Promise<boolean> {
  const baseUrl = service.ServerURL.trim().replace(/\/+$/, "");
  const relativePath = service.checkerPath || defaultPath;

  if (!relativePath) {
    throw new Error(`No checkerPath specified for data source check on service '${service.uniqueId}'.`);
  }

  const baseClean = relativePath.split('?')[0];
  const formattedPath = baseClean.startsWith("/") ? baseClean : `/${baseClean}`;
  const url = `${baseUrl}${formattedPath}?method=getStatus&returnformat=json`;

  const payload = {
    AppKey: service.AppKey,
    AppToken: service.AppToken,
    User: "System"
  };

  const httpClientOptions: IHttpClientOptions = {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json"
    }
  };

  const response: HttpClientResponse = await httpClient.post(url, HttpClient.configurations.v1, httpClientOptions);

  if (!response.ok) {
    throw new Error(`Data source check failed with HTTP ${response.status}.`);
  }

  const data: IDataSourceStatus[] = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Invalid response format: expected an array of data sources.");
  }

  const matchedSource = data.find(
    (item) => item.datasource.toLowerCase() === service.DataSource.toLowerCase()
  );

  return !!matchedSource && matchedSource.available === true;
}