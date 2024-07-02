import {
  Hono
} from 'hono';
import type {
  Context
} from './context';
import {
  build_url,
  create_origin,
  has_trailing_slash,
  Matcher
} from './helpers';

const app = new Hono < Context > ();

app.get('*', async (c): Promise<void | Response> => {
  const {
    DOMAIN,
    WEBFLOW_SUBDOMAIN,
    SUBDOMAINS,
    ROOT,
    S3_BUCKET_NAME,
    ELASTIC_BEANSTALK_URL
  } = c.env;
  const {
    origin,
    hostname,
    pathname,
    search
  } = new URL(c.req.url);

  const main_origin = create_origin(DOMAIN);

  const paths = pathname.split('/').filter(Boolean);

  const matcher = new Matcher(SUBDOMAINS);

 // Handle redirect from www to main domain
  if (hostname === `www.${DOMAIN}`) {
    const redirect_url = build_url([main_origin, paths], search);

    return c.redirect(redirect_url, 301)
  }

  // Handle when hostname has a subdomain
  if (hostname !== DOMAIN) {
    // Subdomain is reverse proxied
    const match = matcher.subdomain_to_path(hostname);
    if (match) {
      const redirect_url = build_url([main_origin, match, paths], search);
      console.log('redirecting from subdomain to path');
      return c.redirect(redirect_url, 301);
    } else if (hostname.startsWith(WEBFLOW_SUBDOMAIN)) {
      const redirect_url = build_url([main_origin, paths], search);
      console.log('redirecting from main webflow subdomain to path');
      return c.redirect(redirect_url, 301);
    } 

  }

  // Handle trailing slashes
  if (paths.length && has_trailing_slash(pathname)) {
    const redirect_url = build_url([origin, paths], search);

    return c.redirect(redirect_url, 301);
  }

  // Path matches reverse proxied subdomain
  const match = matcher.path_to_subdomain(paths);
  if (match) {
    const {
      subdomain,
      wildcard_paths
    } = match;

    // TODO : If the subdomain from the target_origin is 'static-maps', 'establishments' or 'resources',
    const bucket_subdomains = ['static-maps', 'establishments', 'resources', 'seo'];
    const match_index = bucket_subdomains.indexOf(subdomain);
    if (match_index !== -1) { // Subdomain is one of the S3 bucket
      const match_value = bucket_subdomains[match_index];
      let target_origin = "";
      let target_url = "";
      switch (match_value) {
        case 'static-maps':
          target_origin = `https://${S3_BUCKET_NAME}/doctr-app/${match_value}`;
          target_url = build_url([target_origin, wildcard_paths], search);
          return await fetch(target_url);
        case 'establishments':
          target_origin = `https://${S3_BUCKET_NAME}/doctr-app/${match_value}`;
          target_url = build_url([target_origin, wildcard_paths], search);
          return await fetch(target_url);
        case 'resources':
          target_origin = `https://${S3_BUCKET_NAME}/${match_value}`;
          target_url = build_url([target_origin, wildcard_paths], search);
          return await fetch(target_url);
        case 'seo':
          target_origin = `http://${ELASTIC_BEANSTALK_URL}/${match_value}`;
          target_url = build_url([target_origin, wildcard_paths], search);
          return await fetch(target_url);
      }
    }
    const target_origin = create_origin(`${subdomain}.${DOMAIN}`);
    const target_url = build_url([target_origin, wildcard_paths], search);

    let response = await fetch(target_url);

    // Handle redirected responses
    if (response.redirected && response.url) {
     
      // Compare paths with paths from the redirected URL
      const {
        origin,
        hostname,
        pathname,
        search
      } = new URL(response.url);
      const actualpaths = paths.slice(-2);
      const redirectedPaths = pathname.split('/').filter(Boolean).slice(-2);
     
      if (JSON.stringify(actualpaths) !== JSON.stringify(redirectedPaths)) {
        return c.redirect(response.url, 301);
      } else {
        response = await fetch(response.url);
      }
    }

    
    // Modify HTML by adding subdomain prefix to relative href tags
    if (response.headers.get('content-type')?.includes('text/html')) {
      const html = await response.text();
      let modifiedHtml = html;

      // replace root "/" href with subdomain
      modifiedHtml = modifiedHtml.replace(/href="\/["]/g, `href="/${subdomain}/"`);
      modifiedHtml = modifiedHtml.replace(/href='\/[']/g, `href='/${subdomain}/'`);

      // replace href links without subdomain with /subdomain/
      modifiedHtml.match(/href='\/[^']+/g)?.forEach((href) => {
        if (!href.includes(`href='/${subdomain}/`)) {
          const link  = href.replace(/(href='\/)/g, '');
          let expression = new RegExp(`${href}`, 'g'); 
          modifiedHtml = modifiedHtml.replace(expression, `href='/${subdomain}/${link}`);
          expression = new RegExp(`href='/${subdomain}/#`, 'g');
          modifiedHtml = modifiedHtml.replace(expression, `href='/${subdomain}#`);
        }
      });

      modifiedHtml.match(/href="\/[^"]+/g)?.forEach((href) => {
        if (!href.includes(`href="/${subdomain}/`)) {
          const link  = href.replace(/(href="\/)/g, '');
          let expression = new RegExp(`${href}`, 'g'); 
          modifiedHtml = modifiedHtml.replace(expression, `href="/${subdomain}/${link}`);
          expression = new RegExp(`href="/${subdomain}/#`, 'g');
          modifiedHtml = modifiedHtml.replace(expression, `href="/${subdomain}#`);
        }
      });

      response = new Response(modifiedHtml, response);
    }
    
    return response;
  }

  // Get file name from path
  const filename: string = pathname.split('/').pop() !;

  //Get file from R2
  const object = await ROOT.get(filename);

  if (object !== null) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
  
    return new Response(object.body, {
      headers
    });
  }

  // If no subdomains are matched, fetch from the main Webflow project
  const webflow_origin = create_origin(`${WEBFLOW_SUBDOMAIN}.${DOMAIN}`);
  const target_url = await build_url([webflow_origin, paths], search);
  const response = await fetch(target_url);


  // Handle redirected responses
  if (response.redirected && response.url) {
    return c.redirect(response.url, 301);
  }

  return response;
});

export default app;
