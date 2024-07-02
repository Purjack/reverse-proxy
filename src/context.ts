type Env = {
  DOMAIN: string;
  WEBFLOW_SUBDOMAIN: string;
  SUBDOMAINS: string;
  ROOT: R2Bucket;
  S3_BUCKET_NAME: string;
  ELASTIC_BEANSTALK_URL: string;
};

export type Context = {
  Bindings: Env;
};