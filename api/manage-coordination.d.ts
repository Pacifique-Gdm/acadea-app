type CoordinationApiRequest = {
  method?: string;
  headers: Record<string, string | undefined>;
  body?: Record<string, unknown> | string;
  query?: Record<string, string | string[] | undefined>;
};

type CoordinationApiResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(value: string): void;
};

export default function handler(req: CoordinationApiRequest, res: CoordinationApiResponse): Promise<void>;
