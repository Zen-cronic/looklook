export interface Offer {
  url?: string;
  domain: string;
  price: { price: number; compare_at_price?: number | null; currency: string };
  availability?: string;
  condition?: string;
  max_commission_rate?: number;
}

export interface ProductImage {
  url: string;
  is_main_image?: boolean;
  alt_text?: string;
}

export interface Product {
  id: string;
  title: string;
  images?: ProductImage[];
  description?: string;
  brands?: Array<{ id: string; name: string }>;
  category?: { slug: string; title?: string; path?: Array<{ slug: string; title?: string }> };
  offers?: Offer[];
  structured_attributes?: Record<string, string[]>;
  ratings?: { value?: number; count?: number };
  variants?: unknown;
}

export interface SearchResult {
  products: Product[];
  next_page_token?: string | null;
}

export interface RawPricePoint {
  timestamp: string;
  price: number;
  currency?: string;
}

export interface PriceHistory {
  canonical_product_id?: string;
  product_title?: string;
  history: RawPricePoint[];
  statistics?: {
    mean?: number;
    std_dev?: number;
    min_price?: number;
    max_price?: number;
    current_price?: number;
    current_status?: "low" | "typical" | "high";
    currency?: string;
  } | null;
}

export type SubscriptionEvent = "offer.price.changed" | "offer.availability.changed" | "offer.created" | "offer.deleted";

export interface ProductSubscription {
  subscription_id: string;
  product_id?: string;
  status?: string;
  events?: SubscriptionEvent[];
  domains?: string[] | null;
  selection?: unknown;
}
