type CoordinationSchoolYearApiRequest = {
  method?: string;
  headers: Record<string, string | undefined>;
  body?: Record<string, unknown> | string;
};

type CoordinationSchoolYearApiResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(value: string): void;
};

export default function handler(req: CoordinationSchoolYearApiRequest, res: CoordinationSchoolYearApiResponse): Promise<void>;
export const COORDINATION_SCHOOL_YEARS_ROUTE: "coordination-school-years";
