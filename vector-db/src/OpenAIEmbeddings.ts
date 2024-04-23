// Copyright (c) 2023 Steven Ickman

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import axios, { AxiosInstance, AxiosResponse, AxiosRequestConfig } from "axios";
import { EmbeddingsModel, EmbeddingsResponse } from "./types";
import {
  CreateEmbeddingRequest,
  CreateEmbeddingResponse,
  OpenAICreateEmbeddingRequest,
} from "./internals";
import { Colorize } from "./internals";

export interface BaseOpenAIEmbeddingsOptions {
  /**
   * Optional. Whether to log requests to the console.
   * @remarks
   * This is useful for debugging prompts and defaults to `false`.
   */
  logRequests?: boolean;

  /**
   * Optional. Retry policy to use when calling the OpenAI API.
   * @remarks
   * The default retry policy is `[2000, 5000]` which means that the first retry will be after
   * 2 seconds and the second retry will be after 5 seconds.
   */
  retryPolicy?: number[];

  /**
   * Optional. Request options to use when calling the OpenAI API.
   */
  requestConfig?: AxiosRequestConfig;
}

/**
 * Options for configuring an `OpenAIEmbeddings` to generate embeddings using an OSS hosted model.
 */
export interface OSSEmbeddingsOptions extends BaseOpenAIEmbeddingsOptions {
  /**
   * Model to use for completion.
   */
  ossModel: string;

  /**
   * Optional. Endpoint to use when calling the OpenAI API.
   * @remarks
   * For Azure OpenAI this is the deployment endpoint.
   */
  ossEndpoint: string;
}

/**
 * Options for configuring an `OpenAIEmbeddings` to generate embeddings using an OpenAI hosted model.
 */
export interface OpenAIEmbeddingsOptions extends BaseOpenAIEmbeddingsOptions {
  /**
   * API key to use when calling the OpenAI API.
   * @remarks
   * A new API key can be created at https://platform.openai.com/account/api-keys.
   */
  apiKey: string;

  /**
   * Model to use for completion.
   * @remarks
   * For Azure OpenAI this is the name of the deployment to use.
   */
  model: string;

  /**
   * Optional. Organization to use when calling the OpenAI API.
   */
  organization?: string;

  /**
   * Optional. Endpoint to use when calling the OpenAI API.
   * @remarks
   * For Azure OpenAI this is the deployment endpoint.
   */
  endpoint?: string;
}

/**
 * Options for configuring an `OpenAIEmbeddings` to generate embeddings using an Azure OpenAI hosted model.
 */
export interface AzureOpenAIEmbeddingsOptions
  extends BaseOpenAIEmbeddingsOptions {
  /**
   * API key to use when making requests to Azure OpenAI.
   */
  azureApiKey: string;

  /**
   * Deployment endpoint to use.
   */
  azureEndpoint: string;

  /**
   * Name of the Azure OpenAI deployment (model) to use.
   */
  azureDeployment: string;

  /**
   * Optional. Version of the API being called. Defaults to `2023-05-15`.
   */
  azureApiVersion?: string;
}

/**
 * A `PromptCompletionModel` for calling OpenAI and Azure OpenAI hosted models.
 * @remarks
 */
export class OpenAIEmbeddings implements EmbeddingsModel {
  private readonly _httpClient: AxiosInstance;
  private readonly _clientType: ClientType;

  private readonly UserAgent = "AlphaWave";

  public readonly maxTokens = 8000;

  /**
   * Options the client was configured with.
   */
  public readonly options:
    | OSSEmbeddingsOptions
    | OpenAIEmbeddingsOptions
    | AzureOpenAIEmbeddingsOptions;

  /**
   * Creates a new `OpenAIClient` instance.
   * @param options Options for configuring an `OpenAIClient`.
   */
  public constructor(
    options:
      | OSSEmbeddingsOptions
      | OpenAIEmbeddingsOptions
      | AzureOpenAIEmbeddingsOptions
  ) {
    // Check for azure config
    if ((options as AzureOpenAIEmbeddingsOptions).azureApiKey) {
      this._clientType = ClientType.AzureOpenAI;
      this.options = Object.assign(
        {
          retryPolicy: [2000, 5000],
          azureApiVersion: "2023-05-15",
        },
        options
      ) as AzureOpenAIEmbeddingsOptions;

      // Cleanup and validate endpoint
      let endpoint = this.options.azureEndpoint.trim();
      if (endpoint.endsWith("/")) {
        endpoint = endpoint.substring(0, endpoint.length - 1);
      }

      if (!endpoint.toLowerCase().startsWith("https://")) {
        throw new Error(
          `Client created with an invalid endpoint of '${endpoint}'. The endpoint must be a valid HTTPS url.`
        );
      }

      this.options.azureEndpoint = endpoint;
    } else if ((options as OSSEmbeddingsOptions).ossModel) {
      this._clientType = ClientType.OSS;
      this.options = Object.assign(
        {
          retryPolicy: [2000, 5000],
        },
        options
      ) as OSSEmbeddingsOptions;
    } else {
      this._clientType = ClientType.OpenAI;
      this.options = Object.assign(
        {
          retryPolicy: [2000, 5000],
        },
        options
      ) as OpenAIEmbeddingsOptions;
    }

    // Create client
    this._httpClient = axios.create({
      validateStatus: (status) => status < 400 || status == 429,
    });
  }

  /**
   * Creates embeddings for the given inputs using the OpenAI API.
   * @param model Name of the model to use (or deployment for Azure).
   * @param inputs Text inputs to create embeddings for.
   * @returns A `EmbeddingsResponse` with a status and the generated embeddings or a message when an error occurs.
   */
  public async createEmbeddings(
    inputs: string | string[]
  ): Promise<EmbeddingsResponse> {
    if (this.options.logRequests) {
      console.log(Colorize.title("EMBEDDINGS REQUEST:"));
      console.log(Colorize.output(inputs));
    }

    const startTime = Date.now();
    const response = await this.createEmbeddingRequest({
      input: inputs,
    });

    if (this.options.logRequests) {
      console.log(Colorize.title("RESPONSE:"));
      console.log(Colorize.value("status", response.status));
      console.log(Colorize.value("duration", Date.now() - startTime, "ms"));
      console.log(Colorize.output(response.data));
    }

    // Process response
    if (response.status < 300) {
      return {
        status: "success",
        output: response.data.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding),
      };
    } else if (response.status == 429) {
      return {
        status: "rate_limited",
        message: `The embeddings API returned a rate limit error.`,
      };
    } else {
      return {
        status: "error",
        message: `The embeddings API returned an error status of ${response.status}: ${response.statusText}`,
      };
    }
  }

  /**
   * @private
   */
  protected createEmbeddingRequest(
    request: CreateEmbeddingRequest
  ): Promise<AxiosResponse<CreateEmbeddingResponse>> {
    const options = this.options as OpenAIEmbeddingsOptions;
    const url = `${options.endpoint ?? "https://api.openai.com"}/v1/embeddings`;
    (request as OpenAICreateEmbeddingRequest).model = options.model;
    return this.post(url, request);
  }

  /**
   * @private
   */
  protected async post<TData>(
    url: string,
    body: object,
    retryCount = 0
  ): Promise<AxiosResponse<TData>> {
    // Initialize request config
    const requestConfig: AxiosRequestConfig = Object.assign(
      {},
      this.options.requestConfig
    );

    // Initialize request headers
    if (!requestConfig.headers) {
      requestConfig.headers = {};
    }
    if (!requestConfig.headers["Content-Type"]) {
      requestConfig.headers["Content-Type"] = "application/json";
    }
    if (!requestConfig.headers["User-Agent"]) {
      requestConfig.headers["User-Agent"] = this.UserAgent;
    }

    const options = this.options as OpenAIEmbeddingsOptions;
    requestConfig.headers["Authorization"] = `Bearer ${options.apiKey}`;
    if (options.organization) {
      requestConfig.headers["OpenAI-Organization"] = options.organization;
    }

    // Send request
    const response = await this._httpClient.post(url, body, requestConfig);

    // Check for rate limit error
    if (
      response.status == 429 &&
      Array.isArray(this.options.retryPolicy) &&
      retryCount < this.options.retryPolicy.length
    ) {
      const delay = this.options.retryPolicy[retryCount];
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.post(url, body, retryCount + 1);
    } else {
      return response;
    }
  }
}

enum ClientType {
  OpenAI,
  AzureOpenAI,
  OSS,
}
