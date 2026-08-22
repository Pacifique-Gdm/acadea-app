type FinancialTransactionApiRequest = {
  method?: string;
  headers: Record<string, string | undefined>;
  body?: Record<string, unknown> | string;
};

type FinancialTransactionApiResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(value: string): void;
};

export default function handler(
  req: FinancialTransactionApiRequest,
  res: FinancialTransactionApiResponse,
): Promise<void>;
