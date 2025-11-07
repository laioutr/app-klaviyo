export type Location = {
  address1?: string;
  address2?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  region?: string;
  zip?: string;
};

export interface CreateClientSubscriptionPayload {
  listId: string;
  source?: string;
  profile: {
    email: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    title?: string;
    location?: Location;
    properties?: Record<string, unknown>;
  };
}

export interface KlaviyoError {
  id: string;
  status?: number;
  code: string;
  detail: string;
  title: string;
  source?: {
    pointer?: string;
    parameter?: string;
  };
}

export interface KlavyioResponse<T = unknown> {
  data?: T;
  errors?: KlaviyoError[];
}
