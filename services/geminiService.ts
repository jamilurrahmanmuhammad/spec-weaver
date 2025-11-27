  import yaml from 'js-yaml';
  import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, BorderStyle, WidthType, AlignmentType, VerticalAlign } from 'docx';
  import { ConversionMode, ConversionOptions, SpecFormat } from "../types";

  // Helper to parse content which might be JSON or YAML
  const parseContent = (content: string) => {
    try {
      return JSON.parse(content);
    } catch (e) {
      try {
        return yaml.load(content);
      } catch (e2) {
        throw new Error("Invalid format. Please provide valid JSON or YAML.");
      }
    }
  };

  /**
   * Helper to resolve a schema if it is a reference
   */
  const resolveSchema = (schema: any, rootSpec: any): any => {
    if (!schema) return null;
    
    // If it's a reference, try to find it in components
    if (schema.$ref) {
      const refPath = schema.$ref.split('/');
      const refName = refPath[refPath.length - 1];
      
      if (rootSpec.components && rootSpec.components.schemas && rootSpec.components.schemas[refName]) {
        return { 
          ...rootSpec.components.schemas[refName], 
          _resolvedFrom: refName,
          _originalRef: schema.$ref 
        };
      }
    }
    return { ...schema };
  };

  interface FlatSchemaRow {
      path: string;
      type: string;
      required: boolean;
      description: string;
      enum?: string[];
      example?: any;
      ref?: string; // Store the original $ref if this node was a reference
  }

  /**
   * Recursively flattens a schema into a list of rows with JSON paths.
   */
  const flattenSchema = (
      schema: any,
      rootSpec: any,
      currentPath: string = "",
      isRequired: boolean = false,
      rows: FlatSchemaRow[] = [],
      visitedRefs: Set<string> = new Set()
  ): FlatSchemaRow[] => {
      // Check if this specific node is a ref BEFORE resolving properties
      const originalRef = schema.$ref;

      let resolved = resolveSchema(schema, rootSpec);
      if (!resolved) return rows;

      // Cycle detection for recursive refs
      if (resolved._resolvedFrom) {
          if (visitedRefs.has(resolved._resolvedFrom)) {
              rows.push({
                  path: currentPath,
                  type: `Recursive (${resolved._resolvedFrom})`,
                  required: isRequired,
                  description: "Recursive reference detected",
                  ref: originalRef
              });
              return rows;
          }
          visitedRefs.add(resolved._resolvedFrom);
      }

      // Handle allOf (Merge)
      if (resolved.allOf && Array.isArray(resolved.allOf)) {
          const merged: any = { properties: {}, required: [] };
          resolved.allOf.forEach((s: any) => {
              const resolvedS = resolveSchema(s, rootSpec);
              if (resolvedS.properties) Object.assign(merged.properties, resolvedS.properties);
              if (resolvedS.required) merged.required.push(...resolvedS.required);
              // Also merge additionalProperties if present
              if (resolvedS.additionalProperties) merged.additionalProperties = resolvedS.additionalProperties;
          });
          resolved = { ...resolved, ...merged };
      }

      // Handle oneOf / anyOf (Polymorphism) - We treat them as potential options
      // This isn't perfect for visual flattening but ensures data isn't hidden.
      const polymorphic = resolved.oneOf || resolved.anyOf;
      if (polymorphic && Array.isArray(polymorphic)) {
          polymorphic.forEach((s: any, idx: number) => {
              // We process these as if they are merged, but we might want to indicate option?
              // For simplicity in a flat table, we just list the potential paths.
              // If paths overlap, they will appear twice, which is actually correct for "Option A has id, Option B has id".
              flattenSchema(s, rootSpec, currentPath, isRequired, rows, new Set(visitedRefs));
          });
          // If the root itself didn't have properties but was just a oneOf wrapper, we might be done unless we want to label the container
      }

      const type = resolved.type || (resolved.properties ? 'object' : 'string');

      // Add row for the current node
      // Condition: 
      // 1. It has a path (not root) OR
      // 2. It is root AND it is a Ref (we want to show the ref badge) OR
      // 3. It is root AND it is an Array (we want to show [] root)
      if (currentPath || originalRef || type === 'array') {
          // However, we usually skip the *exact* empty root row for Objects unless it's a ref holder
          if (currentPath || (type !== 'object' && type !== undefined) || originalRef) {
              // Avoid duplicate rows if oneOf caused recursion on same path
              const exists = rows.find(r => r.path === currentPath && r.type === type && r.description === (resolved.description || ''));
              if (!exists) {
                  rows.push({
                      path: currentPath,
                      type: type,
                      required: isRequired,
                      description: resolved.description || '',
                      enum: resolved.enum,
                      example: resolved.example,
                      ref: originalRef
                  });
              }
          }
      }

      // 1. Handle Object Properties
      if (resolved.properties) {
          const requiredFields = resolved.required || [];
          Object.entries(resolved.properties).forEach(([key, prop]: [string, any]) => {
              const childPath = currentPath ? `${currentPath}.${key}` : key;
              const childIsReq = requiredFields.includes(key);
              flattenSchema(prop, rootSpec, childPath, childIsReq, rows, new Set(visitedRefs));
          });
      }
      
      // 2. Handle Maps (additionalProperties)
      if (resolved.additionalProperties) {
          const childPath = currentPath ? `${currentPath}.<key>` : '<key>';
          // additionalProperties can be boolean(true) or a schema
          if (typeof resolved.additionalProperties === 'object') {
              flattenSchema(resolved.additionalProperties, rootSpec, childPath, false, rows, new Set(visitedRefs));
          } else {
              // Generic object
              rows.push({
                  path: childPath,
                  type: 'any',
                  required: false,
                  description: 'Any value allowed',
              });
          }
      }

      // 3. Handle Arrays
      if (type === 'array' && resolved.items) {
          const childPath = currentPath + "[]";
          flattenSchema(resolved.items, rootSpec, childPath, false, rows, new Set(visitedRefs));
      }

      return rows;
  };

  /**
   * Reconstructs a nested schema object from flat path rows (Unflattening)
   */
  const unflattenSchema = (rows: {path: string, type: string, description: string, ref?: string}[]) => {
      const rootSchema: any = { type: 'object', properties: {} };
      const skippedPaths: string[] = [];

      rows.forEach(row => {
          if (!row.path) return;
          
          // Check if this path is a child of a skipped ref path
          if (skippedPaths.some(p => row.path.startsWith(p + '.') || row.path.startsWith(p + '['))) {
              return;
          }

          // Split by dot, but handle <key> special case
          const parts = row.path.split('.');
          
          let current = rootSchema;

          parts.forEach((part, index) => {
              const isLast = index === parts.length - 1;
              const isArrayItem = part.endsWith('[]');
              const cleanPart = isArrayItem ? part.slice(0, -2) : part;

              // SPECIAL CASE: Root Array
              if (cleanPart === '') {
                  if (current.type !== 'array') {
                      current.type = 'array';
                      current.items = { type: 'object', properties: {} };
                      delete current.properties;
                  }
                  current = current.items;

                  if (isLast) {
                        if (row.ref) {
                            Object.keys(current).forEach(k => delete current[k]);
                            current.$ref = row.ref;
                            skippedPaths.push(row.path); 
                        } else {
                            if (row.type !== 'array') current.type = row.type;
                            current.description = row.description;
                            if (row.type !== 'object' && row.type !== 'array') delete current.properties;
                        }
                  }
                  return;
              }

              // Handling Map/Dictionary keys
              if (cleanPart === '<key>' || cleanPart === '*') {
                  if (!current.additionalProperties) {
                      current.additionalProperties = { type: 'object', properties: {} };
                      // If it was assumed to be an object with props, we might need to clean up, but usually mixed is rare
                  }
                  current = current.additionalProperties;

                  if (isLast) {
                      if (row.ref) {
                          Object.keys(current).forEach(k => delete current[k]);
                          current.$ref = row.ref;
                          skippedPaths.push(row.path);
                      } else {
                          current.type = row.type;
                          current.description = row.description;
                          if (row.type !== 'object' && row.type !== 'array') delete current.properties;
                      }
                  }
                  return;
              }

              // Normal property handling
              if (!current.properties) current.properties = {};
              
              if (isArrayItem) {
                  if (!current.properties[cleanPart]) {
                      current.properties[cleanPart] = { type: 'array', items: { type: 'object', properties: {} } };
                  }
                  current = current.properties[cleanPart].items;
                  
                  if (isLast) {
                      if (row.ref) {
                          Object.keys(current).forEach(k => delete current[k]);
                          current.$ref = row.ref;
                          skippedPaths.push(row.path);
                      } else {
                          if (row.type !== 'array') current.type = row.type; 
                          current.description = row.description;
                          if (row.type !== 'object' && row.type !== 'array') delete current.properties;
                      }
                  }
              } else {
                  if (!current.properties[cleanPart]) {
                      current.properties[cleanPart] = { type: 'object', properties: {} };
                  }

                  if (isLast) {
                      if (row.ref) {
                          const target = current.properties[cleanPart];
                          Object.keys(target).forEach(k => delete target[k]);
                          target.$ref = row.ref;
                          skippedPaths.push(row.path);
                      } else {
                          current.properties[cleanPart].type = row.type;
                          current.properties[cleanPart].description = row.description;
                          if (row.type !== 'object' && row.type !== 'array') delete current.properties[cleanPart].properties;
                      }
                  } else {
                      current = current.properties[cleanPart];
                  }
              }
          });
      });

      return rootSchema;
  };


  /**
   * Helper to generate an HTML table from a Schema object using the Flattening strategy
   */
  const generateSchemaTableHTML = (schema: any, rootSpec: any, title: string = "Properties"): string => {
    if (!schema) return '';

    // Detect top-level Ref
    const topLevelRef = schema.$ref;
    
    const rows = flattenSchema(schema, rootSpec);

    if (rows.length === 0) return '';

    const tableStyle = "width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; border: 1px solid #cbd5e1; font-size: 0.875rem; background: white;";
    const thStyle = "background-color: #f1f5f9; padding: 0.75rem; text-align: left; border: 1px solid #cbd5e1; font-weight: 700; color: #334155;";
    const tdStyle = "padding: 0.75rem; border: 1px solid #cbd5e1; color: #334155; vertical-align: top;";
    const codeStyle = "font-family: monospace; color: #0f172a; font-weight: 600; background: #f1f5f9; padding: 2px 4px; border-radius: 4px;";
    const badgeStyle = "display: inline-block; background-color: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; margin-left: 8px;";

    let containerAttrs = topLevelRef ? `data-schema-ref="${topLevelRef}"` : '';
    
    let html = `<div style="margin-top: 1rem;" class="schema-container" ${containerAttrs}>`;
    if (title) {
        let titleHtml = title;
        if (topLevelRef) {
            const refName = topLevelRef.split('/').pop();
            titleHtml += `<span style="${badgeStyle}">Ref: ${refName}</span>`;
        }
        html += `<h5 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.5rem; color: #1e293b;">${titleHtml}</h5>`;
    }
    
    html += `<table style="${tableStyle}" class="data-table">
      <thead>
        <tr>
          <th style="${thStyle} width: 30%;">JSON Path</th>
          <th style="${thStyle} width: 15%;">Type</th>
          <th style="${thStyle} width: 10%;">Required</th>
          <th style="${thStyle}">Description</th>
        </tr>
      </thead>
      <tbody>`;
    
    rows.forEach(row => {
        let desc = row.description;
        
        if (row.enum) {
            desc += `<br/><span style="font-size: 0.75rem; color: #64748b;">Allowed: ${row.enum.join(', ')}</span>`;
        }
        if (row.example) {
            desc += `<br/><span style="font-size: 0.75rem; color: #64748b;">Example: ${row.example}</span>`;
        }

        const pathParts = row.path.split('.');
        const pathDisplay = pathParts.length > 1 
          ? `<span style="color:#64748b">${pathParts.slice(0, -1).join('.')}.</span><span style="${codeStyle}">${pathParts[pathParts.length-1]}</span>`
          : `<span style="${codeStyle}">${row.path}</span>`;

        // If this specific row is a ref origin (and not just part of a top level ref which is handled by container), add data attr
        const rowAttrs = row.ref ? `data-ref="${row.ref}"` : '';
        const typeDisplay = row.ref ? `${row.type} <span style="font-size:0.7rem; color: #6366f1;">(Ref)</span>` : row.type;

        html += `<tr ${rowAttrs}>
          <td style="${tdStyle}" class="field-path" data-raw-path="${row.path}">${pathDisplay}</td>
          <td style="${tdStyle}" class="field-type">${typeDisplay}</td>
          <td style="${tdStyle}" class="field-required">${row.required ? 'Yes' : 'No'}</td>
          <td style="${tdStyle}" class="field-desc">${desc || '-'}</td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    
    return html;
  }

  /**
   * Deterministic Spec to HTML Converter (For Preview)
   */
  const convertSpecToDoc = (content: string, options: ConversionOptions): string => {
    const spec = parseContent(content);
    
    let html = `<!DOCTYPE html>
  <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head>
      <meta charset="utf-8">
      <title>${spec.info?.title || 'API Documentation'}</title>
      <style>
          body { font-family: 'Inter', 'Calibri', sans-serif; line-height: 1.6; color: #1e293b; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1, h2, h3, h4, h5 { color: #0f172a; }
          table { width: 100%; border-collapse: collapse; }
          td, th { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; }
          code { font-family: monospace; background: #f1f5f9; padding: 2px 4px; border-radius: 4px; }
          .badge { background: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; display: inline-block; }
      </style>
  </head>
  <body>
  <div class="doc-content">`;

    // 1. Title & Info
    if (spec.info) {
      html += `<h1 class="doc-title" style="font-size: 2.25rem; font-weight: 800; margin-bottom: 0.5rem; border-bottom: 4px solid #3b82f6; padding-bottom: 1rem;">${spec.info.title || 'API Documentation'}</h1>`;
      if (spec.info.version) html += `<p class="doc-version" style="margin-bottom: 0.5rem; color: #64748b;"><strong>Version:</strong> ${spec.info.version}</p>`;
      if (spec.info.description) html += `<p class="doc-desc" style="margin-bottom: 2rem; font-size: 1.1rem;">${spec.info.description}</p>`;
    }

    // 2. Executive Summary
    html += `<h2 style="font-size: 1.75rem; font-weight: 700; margin-top: 2.5rem; margin-bottom: 1.5rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem;">Executive Summary</h2>`;
    html += `<p style="margin-bottom: 1rem;">This document outlines the technical specifications for the ${spec.info?.title || 'API'}.</p>`;

    // 3. Servers
    if (spec.servers && spec.servers.length > 0) {
        html += `<h3 style="font-size: 1.4rem; font-weight: 700; margin-top: 2rem;">Servers</h3>`;
        html += `<div class="servers-section"><table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; border: 1px solid #cbd5e1;">
          <thead><tr style="background:#f1f5f9;"><th style="padding:8px; border:1px solid #cbd5e1;">URL</th><th style="padding:8px; border:1px solid #cbd5e1;">Description</th></tr></thead><tbody>`;
        spec.servers.forEach((srv: any) => {
            html += `<tr><td class="server-url" style="padding:8px; border:1px solid #cbd5e1; font-family:monospace;">${srv.url}</td><td class="server-desc" style="padding:8px; border:1px solid #cbd5e1;">${srv.description || '-'}</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    // 4. Global Security & Tags
    if (spec.security || spec.tags) {
        html += `<div style="display:flex; gap: 2rem; margin-bottom: 2rem;">`;
        
        if (spec.security) {
            html += `<div class="security-section" style="flex:1;">
              <h3 style="font-size: 1.2rem; font-weight: 700;">Global Security</h3>
              <ul style="padding-left: 1.2rem;">`;
            spec.security.forEach((sec: any) => {
                const key = Object.keys(sec)[0];
                const scopes = sec[key];
                html += `<li data-sec-name="${key}" data-sec-scopes="${scopes.join(',')}"><strong>${key}</strong> ${scopes.length ? `(${scopes.join(', ')})` : ''}</li>`;
            });
            html += `</ul></div>`;
        }

        if (spec.tags) {
            html += `<div class="tags-section" style="flex:1;">
              <h3 style="font-size: 1.2rem; font-weight: 700;">Tags</h3>
              <ul style="padding-left: 1.2rem;">`;
            spec.tags.forEach((tag: any) => {
                html += `<li data-tag-name="${tag.name}"><strong>${tag.name}</strong>: ${tag.description || ''}</li>`;
            });
            html += `</ul></div>`;
        }
        html += `</div>`;
    }

    // 5. Endpoints
    if (spec.paths) {
      html += `<h2 style="font-size: 1.75rem; font-weight: 700; margin-top: 2.5rem; margin-bottom: 1.5rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem;">Endpoints</h2>`;
      
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, details] of Object.entries(methods as any)) {
          const op = details as any;
          const methodColor = method === 'get' ? '#2563eb' : method === 'post' ? '#16a34a' : method === 'delete' ? '#dc2626' : '#d97706';
          
          const opAttrs = `data-operation-id="${op.operationId || ''}" data-tags="${(op.tags || []).join(',')}"`;

          html += `<div class="op-container" ${opAttrs} style="background: #fff; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 2rem; margin-bottom: 2.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">`;
          
          html += `<h3 class="op-header" style="font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; display: flex; align-items: center; gap: 1rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 1rem;">
            <span class="op-method" style="background-color: ${methodColor}; color: white; padding: 0.35rem 1rem; border-radius: 0.5rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em;">${method}</span>
            <span class="op-path" style="font-family: monospace; color: #334155;">${path}</span>
          </h3>`;
          
          // Metadata
          html += `<div style="margin-bottom: 1.5rem; font-size: 0.9rem; color: #64748b; display: flex; gap: 1rem; flex-wrap: wrap;">`;
          if (op.operationId) html += `<span><strong>ID:</strong> <span class="op-id">${op.operationId}</span></span>`;
          if (op.tags && op.tags.length) html += `<span><strong>Tags:</strong> ${op.tags.map((t:string) => `<span class="badge">${t}</span>`).join(' ')}</span>`;
          if (op.security) {
              const secStr = op.security.map((s: any) => Object.keys(s)[0]).join(', ');
              html += `<span><strong>Security:</strong> <span class="op-security" data-raw='${JSON.stringify(op.security)}'>${secStr}</span></span>`;
          }
          html += `</div>`;

          if (op.summary) html += `<p style="margin-bottom: 0.5rem;"><strong>Summary:</strong> <span class="op-summary">${op.summary}</span></p>`;
          if (op.description) html += `<p class="op-desc" style="margin-bottom: 1.5rem; color: #475569;">${op.description}</p>`;

          // Parameters
          if (op.parameters && op.parameters.length > 0) {
            html += `<h4 style="font-size: 1.1rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 1rem; color: #1e293b; padding-left: 0.5rem; border-left: 4px solid #94a3b8;">Parameters</h4>`;
            const tableStyle = "width: 100%; border-collapse: collapse; margin-bottom: 1rem; border: 1px solid #cbd5e1; font-size: 0.875rem;";
            html += `<table class="params-table" style="${tableStyle}">
              <thead><tr style="background-color: #f1f5f9;"><th style="padding:8px; border:1px solid #cbd5e1;">Name</th><th style="padding:8px; border:1px solid #cbd5e1;">In</th><th style="padding:8px; border:1px solid #cbd5e1;">Required</th><th style="padding:8px; border:1px solid #cbd5e1;">Type</th><th style="padding:8px; border:1px solid #cbd5e1;">Description</th></tr></thead><tbody>`;
            op.parameters.forEach((param: any) => {
              html += `<tr>
                <td class="param-name" style="padding:8px; border:1px solid #cbd5e1; font-family: monospace; font-weight: 600;">${param.name}</td>
                <td class="param-in" style="padding:8px; border:1px solid #cbd5e1;">${param.in}</td>
                <td class="param-req" style="padding:8px; border:1px solid #cbd5e1;">${param.required ? 'Yes' : 'No'}</td>
                <td class="param-type" style="padding:8px; border:1px solid #cbd5e1;">${param.schema?.type || 'string'}</td>
                <td class="param-desc" style="padding:8px; border:1px solid #cbd5e1;">${param.description || '-'}</td>
              </tr>`;
            });
            html += `</tbody></table>`;
          }

          // Request Body
          if (op.requestBody && op.requestBody.content) {
              html += `<h4 class="req-body-title" style="font-size: 1.1rem; font-weight: 600; margin-top: 2rem; margin-bottom: 1rem; color: #1e293b; padding-left: 0.5rem; border-left: 4px solid #16a34a;">Request Body</h4>`;
              for (const [contentType, content] of Object.entries(op.requestBody.content as any)) {
                  html += `<div class="req-body-content" style="margin-bottom: 1.5rem;">`;
                  html += `<p style="margin-bottom: 0.5rem;"><strong>Content-Type:</strong> <code style="background: #f1f5f9; padding: 2px 4px; border-radius: 4px;">${contentType}</code></p>`;
                  html += generateSchemaTableHTML((content as any).schema, spec, "Body Schema");
                  html += `</div>`;
              }
          }

          // Responses
          if (op.responses) {
            html += `<h4 style="font-size: 1.1rem; font-weight: 600; margin-top: 2rem; margin-bottom: 1rem; color: #1e293b; padding-left: 0.5rem; border-left: 4px solid #2563eb;">Responses</h4>`;
            for (const [code, res] of Object.entries(op.responses as any)) {
              const response = res as any;
              const isSuccess = code.startsWith('2');
              const boxColor = isSuccess ? '#f0fdf4' : '#fef2f2';
              const borderColor = isSuccess ? '#bbf7d0' : '#fecaca';

              html += `<div class="resp-container" style="background-color: ${boxColor}; border: 1px solid ${borderColor}; padding: 1.5rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">`;
              html += `<p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem;"><span class="resp-code">HTTP ${code}</span> <span style="font-weight: 400; color: #64748b;">- ${response.description || ''}</span></p>`;

              if (response.headers && Object.keys(response.headers).length > 0) {
                  html += `<h5 style="font-size: 0.95rem; font-weight: 700; margin-top: 1rem; margin-bottom: 0.5rem;">Response Headers</h5>`;
                  html += `<table class="resp-headers-table" style="width: 100%; border-collapse: collapse; margin-bottom: 1rem; border: 1px solid #cbd5e1;">
                    <thead><tr style="background:#f8fafc;"><th style="padding:8px; border:1px solid #cbd5e1;">Header Name</th><th style="padding:8px; border:1px solid #cbd5e1;">Type</th><th style="padding:8px; border:1px solid #cbd5e1;">Description</th></tr></thead><tbody>`;
                  for (const [hName, hVal] of Object.entries(response.headers as any)) {
                      const h = hVal as any;
                      html += `<tr><td class="header-name" style="padding:8px; border:1px solid #cbd5e1;">${hName}</td><td class="header-type" style="padding:8px; border:1px solid #cbd5e1;">${h.schema?.type || 'string'}</td><td class="header-desc" style="padding:8px; border:1px solid #cbd5e1;">${h.description || '-'}</td></tr>`;
                  }
                  html += `</tbody></table>`;
              }

              if (response.content) {
                  for (const [contentType, content] of Object.entries(response.content as any)) {
                      html += `<div class="resp-body-content" style="margin-top: 1rem;">`;
                      html += `<p style="margin-bottom: 0.5rem;"><strong>Content-Type:</strong> <code style="background: white; padding: 2px 4px; border-radius: 4px; border: 1px solid #cbd5e1;">${contentType}</code></p>`;
                      html += generateSchemaTableHTML((content as any).schema, spec, "Response Data Structure");
                      html += `</div>`;
                  }
              }
              html += `</div>`;
            }
          }
          html += `</div>`;
        }
      }
    }

    // 6. Data Models
    if (spec.components && spec.components.schemas && Object.keys(spec.components.schemas).length > 0) {
        html += `<h2 style="font-size: 1.75rem; font-weight: 700; margin-top: 3rem; margin-bottom: 1.5rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem;">Data Models</h2>`;
        html += `<div class="components-section">`;
        for (const [name, schema] of Object.entries(spec.components.schemas)) {
            html += `<div class="component-def" data-component-name="${name}" style="margin-bottom: 2rem; border: 1px solid #e2e8f0; padding: 1.5rem; rounded-lg;">`;
            html += `<h3 id="model-${name}" style="font-size: 1.3rem; margin-bottom: 1rem; color: #3730a3;">${name}</h3>`;
            html += generateSchemaTableHTML(schema, spec, `Properties`);
            html += `</div>`;
        }
        html += `</div>`;
    }

    html += `</div></body></html>`; 
    return html;
  };

  /**
   * Generates a real DOCX Blob using 'docx' library
   */
  export const generateDocxBlob = async (specContent: string, options: ConversionOptions): Promise<Blob> => {
      const spec = parseContent(specContent);
      const sections = [];
      const children: any[] = [];

      // Styles for Tables
      const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: "cbd5e1" };
      const tableBorders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle, insideVertical: borderStyle, insideHorizontal: borderStyle };

      const createHeaderCell = (text: string) => new TableCell({
          children: [new Paragraph({ text, style: "strong" })],
          shading: { fill: "f1f5f9" },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 100, bottom: 100, left: 100, right: 100 }
      });

      const createCell = (text: string) => new TableCell({
          children: [new Paragraph({ text })],
          verticalAlign: VerticalAlign.TOP,
          margins: { top: 100, bottom: 100, left: 100, right: 100 }
      });

      const createSchemaTable = (schema: any, rootSpec: any) => {
          const rows = flattenSchema(schema, rootSpec);
          if (rows.length === 0) return null;

          return new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: tableBorders,
              rows: [
                  new TableRow({
                      children: [createHeaderCell("JSON Path"), createHeaderCell("Type"), createHeaderCell("Required"), createHeaderCell("Description")]
                  }),
                  ...rows.map(row => {
                      let typeText = row.type;
                      if (row.ref) typeText += " (Ref)";
                      
                      let desc = row.description || '-';
                      if (row.enum) desc += ` [Allowed: ${row.enum.join(', ')}]`;

                      return new TableRow({
                          children: [createCell(row.path), createCell(typeText), createCell(row.required ? "Yes" : "No"), createCell(desc)]
                      });
                  })
              ]
          });
      };

      // 1. Info
      children.push(new Paragraph({
          text: spec.info?.title || "API Documentation",
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 }
      }));
      if (spec.info?.description) {
          children.push(new Paragraph({ text: spec.info.description, spacing: { after: 400 } }));
      }

      // 2. Servers
      if (spec.servers && spec.servers.length > 0) {
          children.push(new Paragraph({ text: "Servers", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }));
          children.push(new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: tableBorders,
              rows: [
                  new TableRow({ children: [createHeaderCell("URL"), createHeaderCell("Description")] }),
                  ...spec.servers.map((s: any) => new TableRow({ children: [createCell(s.url), createCell(s.description || '-')] }))
              ]
          }));
      }

      // 3. Endpoints
      if (spec.paths) {
          children.push(new Paragraph({ text: "Endpoints", heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }));

          for (const [path, methods] of Object.entries(spec.paths)) {
              for (const [method, details] of Object.entries(methods as any)) {
                  const op = details as any;
                  
                  children.push(new Paragraph({ 
                      text: `${method.toUpperCase()} ${path}`, 
                      heading: HeadingLevel.HEADING_3, 
                      spacing: { before: 400, after: 100 },
                      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "e2e8f0" } } 
                  }));

                  if (op.summary) children.push(new Paragraph({ children: [new TextRun({ text: "Summary: ", bold: true }), new TextRun(op.summary)] }));
                  if (op.description) children.push(new Paragraph({ text: op.description, spacing: { after: 200 } }));

                  // Parameters
                  if (op.parameters && op.parameters.length > 0) {
                      children.push(new Paragraph({ text: "Parameters", heading: HeadingLevel.HEADING_4, spacing: { after: 100 } }));
                      children.push(new Table({
                          width: { size: 100, type: WidthType.PERCENTAGE },
                          borders: tableBorders,
                          rows: [
                              new TableRow({ children: [createHeaderCell("Name"), createHeaderCell("In"), createHeaderCell("Type"), createHeaderCell("Description")] }),
                              ...op.parameters.map((p: any) => new TableRow({
                                  children: [createCell(p.name), createCell(p.in), createCell(p.schema?.type || 'string'), createCell(p.description || '-')]
                              }))
                          ]
                      }));
                  }

                  // Request Body
                  if (op.requestBody && op.requestBody.content) {
                      children.push(new Paragraph({ text: "Request Body", heading: HeadingLevel.HEADING_4, spacing: { before: 200, after: 100 } }));
                      for (const [contentType, content] of Object.entries(op.requestBody.content as any)) {
                          children.push(new Paragraph({ children: [new TextRun({ text: "Content-Type: ", bold: true }), new TextRun(contentType)] }));
                          const table = createSchemaTable((content as any).schema, spec);
                          if (table) children.push(table);
                      }
                  }

                  // Responses
                  if (op.responses) {
                      children.push(new Paragraph({ text: "Responses", heading: HeadingLevel.HEADING_4, spacing: { before: 200, after: 100 } }));
                      for (const [code, res] of Object.entries(op.responses as any)) {
                          const r = res as any;
                          children.push(new Paragraph({ 
                              children: [new TextRun({ text: `HTTP ${code}`, bold: true, color: "2563eb" }), new TextRun(` - ${r.description || ''}`)],
                              spacing: { before: 100 }
                          }));
                          
                          if (r.content) {
                              for (const [contentType, content] of Object.entries(r.content as any)) {
                                  const table = createSchemaTable((content as any).schema, spec);
                                  if (table) {
                                      children.push(new Paragraph({ text: `Schema (${contentType})`, spacing: { before: 50 } }));
                                      children.push(table);
                                  }
                              }
                          }
                      }
                  }
              }
          }
      }

      // 4. Components
      if (spec.components && spec.components.schemas) {
          children.push(new Paragraph({ text: "Data Models", heading: HeadingLevel.HEADING_2, spacing: { before: 600, after: 200 } }));
          for (const [name, schema] of Object.entries(spec.components.schemas)) {
              children.push(new Paragraph({ text: name, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } }));
              const table = createSchemaTable(schema, spec);
              if (table) children.push(table);
          }
      }

      const doc = new Document({
          sections: [{ children }]
      });

      return await Packer.toBlob(doc);
  };

  /**
   * Parses an HTML string (generated by this tool) back into an OpenAPI Spec object.
   */
  const parseHTMLDocToSpec = (html: string, options: ConversionOptions): string => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract Title/Desc
      const title = doc.querySelector('.doc-title')?.textContent || "Imported API";
      const description = doc.querySelector('.doc-desc')?.textContent || "";
      const version = doc.querySelector('.doc-version')?.textContent?.replace('Version:', '').trim() || "1.0.0";
      
      // 1. Root Metadata
      const servers: any[] = [];
      doc.querySelectorAll('.servers-section tbody tr').forEach(tr => {
          servers.push({
              url: tr.querySelector('.server-url')?.textContent?.trim(),
              description: tr.querySelector('.server-desc')?.textContent?.trim()
          });
      });

      const tags: any[] = [];
      doc.querySelectorAll('.tags-section li').forEach(li => {
          const name = li.getAttribute('data-tag-name');
          if (name) {
              // Remove 'Name:' bold part from text content
              const desc = li.textContent?.replace(name, '').replace(/^[:\s-]+/, '').trim();
              tags.push({ name, description: desc });
          }
      });

      const security: any[] = [];
      doc.querySelectorAll('.security-section li').forEach(li => {
          const name = li.getAttribute('data-sec-name');
          const scopesStr = li.getAttribute('data-sec-scopes');
          if (name) {
              const secObj: any = {};
              secObj[name] = scopesStr ? scopesStr.split(',').filter(s => s) : [];
              security.push(secObj);
          }
      });

      // 2. Components
      const components: any = { schemas: {} };
      doc.querySelectorAll('.component-def').forEach(el => {
          const name = el.getAttribute('data-component-name');
          if (name) {
              const table = el.querySelector('.data-table');
              if (table) {
                  const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
                      const pathEl = tr.querySelector('.field-path');
                      const path = pathEl?.getAttribute('data-raw-path') || pathEl?.textContent?.trim() || '';
                      return {
                          path: path,
                          type: tr.querySelector('.field-type')?.textContent?.replace('(Ref)', '').trim() || 'string',
                          description: tr.querySelector('.field-desc')?.textContent?.trim() || '',
                          ref: tr.getAttribute('data-ref') || undefined
                      };
                  });
                  components.schemas[name] = unflattenSchema(rows);
              }
          }
      });

      // 3. Paths
      const paths: any = {};
      doc.querySelectorAll('.op-container').forEach(op => {
          const methodEl = op.querySelector('.op-method');
          const pathEl = op.querySelector('.op-path');
          if (!methodEl || !pathEl) return;

          const method = methodEl.textContent?.toLowerCase().trim() || 'get';
          const path = pathEl.textContent?.trim() || '/';
          const summary = op.querySelector('.op-summary')?.textContent || '';
          const opDesc = op.querySelector('.op-desc')?.textContent || '';
          
          // Operation Metadata
          const operationId = op.getAttribute('data-operation-id') || undefined;
          const tagsAttr = op.getAttribute('data-tags');
          const opTags = tagsAttr ? tagsAttr.split(',').filter(t => t) : undefined;
          
          // Operation Security
          let opSecurity = undefined;
          const secSpan = op.querySelector('.op-security');
          if (secSpan && secSpan.getAttribute('data-raw')) {
              try { opSecurity = JSON.parse(secSpan.getAttribute('data-raw')!); } catch(e){}
          }

          if (!paths[path]) paths[path] = {};

          const operation: any = {
              summary,
              description: opDesc,
              operationId,
              tags: opTags,
              security: opSecurity,
              responses: {}
          };

          // Parameters
          const paramsTable = op.querySelector('.params-table');
          if (paramsTable) {
              const rows = paramsTable.querySelectorAll('tbody tr');
              if (rows.length > 0) operation.parameters = [];
              rows.forEach(tr => {
                  const name = tr.querySelector('.param-name')?.textContent || '';
                  const inLoc = tr.querySelector('.param-in')?.textContent || 'query';
                  const required = tr.querySelector('.param-req')?.textContent === 'Yes';
                  const type = tr.querySelector('.param-type')?.textContent || 'string';
                  const desc = tr.querySelector('.param-desc')?.textContent || '';
                  if (name) {
                      operation.parameters.push({
                          name, in: inLoc, required, schema: { type }, description: desc
                      });
                  }
              });
          }

          // Request Body
          const reqBodyTitle = op.querySelector('.req-body-title');
          if (reqBodyTitle) {
              let nextEl = reqBodyTitle.nextElementSibling;
              while (nextEl && nextEl.classList.contains('req-body-content')) {
                  const container = nextEl.querySelector('.schema-container');
                  if (container) {
                      const topRef = container.getAttribute('data-schema-ref');
                      let schema;
                      
                      if (topRef) {
                          schema = { $ref: topRef };
                      } else {
                          const table = container.querySelector('.data-table');
                          if (table) {
                              const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => ({
                                  path: tr.querySelector('.field-path')?.getAttribute('data-raw-path') || '',
                                  type: tr.querySelector('.field-type')?.textContent?.replace('(Ref)', '').trim() || 'string',
                                  description: tr.querySelector('.field-desc')?.textContent?.trim() || '',
                                  ref: tr.getAttribute('data-ref') || undefined
                              }));
                              schema = unflattenSchema(rows);
                          }
                      }

                      if (schema) {
                          if (!operation.requestBody) operation.requestBody = { content: {} };
                          operation.requestBody.content['application/json'] = { schema };
                      }
                  }
                  nextEl = nextEl.nextElementSibling;
              }
          }

          // Responses
          op.querySelectorAll('.resp-container').forEach(rc => {
              const codeText = rc.querySelector('.resp-code')?.textContent || 'HTTP 200';
              const code = codeText.replace('HTTP', '').trim();
              const desc = rc.querySelector('p span:nth-child(2)')?.textContent?.replace(/^-\s*/, '') || '';
              
              operation.responses[code] = { description: desc };

              const headerTable = rc.querySelector('.resp-headers-table');
              if (headerTable) {
                  const hRows = headerTable.querySelectorAll('tbody tr');
                  const headers: any = {};
                  hRows.forEach(tr => {
                      const name = tr.querySelector('.header-name')?.textContent || '';
                      if (name) {
                          headers[name] = {
                              schema: { type: tr.querySelector('.header-type')?.textContent || 'string' },
                              description: tr.querySelector('.header-desc')?.textContent || ''
                          };
                      }
                  });
                  operation.responses[code].headers = headers;
              }

              const bodyContainer = rc.querySelector('.resp-body-content .schema-container');
              if (bodyContainer) {
                  const topRef = bodyContainer.getAttribute('data-schema-ref');
                  let schema;
                  if (topRef) {
                      schema = { $ref: topRef };
                  } else {
                      const table = bodyContainer.querySelector('.data-table');
                      if (table) {
                          const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => ({
                              path: tr.querySelector('.field-path')?.getAttribute('data-raw-path') || '',
                              type: tr.querySelector('.field-type')?.textContent?.replace('(Ref)', '').trim() || 'string',
                              description: tr.querySelector('.field-desc')?.textContent?.trim() || '',
                              ref: tr.getAttribute('data-ref') || undefined
                          }));
                          schema = unflattenSchema(rows);
                      }
                  }
                  if (schema) {
                      operation.responses[code].content = { 'application/json': { schema } };
                  }
              }
          });

          paths[path][method] = operation;
      });

      const spec: any = {
          openapi: "3.0.0",
          info: { title, version, description },
          paths
      };

      if (servers.length) spec.servers = servers;
      if (tags.length) spec.tags = tags;
      if (security.length) spec.security = security;
      if (Object.keys(components.schemas).length) spec.components = components;

      if (options.outputFormat === SpecFormat.JSON) {
          return JSON.stringify(spec, null, 2);
      } else {
          return yaml.dump(spec);
      }
  }

  /**
   * Deterministic Text to Spec Converter (Legacy Text Support + HTML Support)
   */
  const convertDocToSpec = (content: string, options: ConversionOptions): string => {
    if (content.trim().startsWith('<')) {
        return parseHTMLDocToSpec(content, options);
    }
    // Fallback to text parsing if needed (kept from previous iteration but simplified)
    return "Error: Please provide the HTML Source code generated by this tool.";
  };

  export const generateConversion = async (
    content: string,
    mode: ConversionMode,
    options: ConversionOptions
  ): Promise<string> => {
    if (!content.trim()) return "";
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      if (mode === ConversionMode.SPEC_TO_DOC) {
        return convertSpecToDoc(content, options);
      } else {
        return convertDocToSpec(content, options);
      }
    } catch (error: any) {
      console.error("Conversion Error:", error);
      return `Error: ${error.message}`;
    }
  };

  export const generateConversionStream = async function* (
      content: string,
      mode: ConversionMode,
      options: ConversionOptions
    ) {
      const result = await generateConversion(content, mode, options);
      yield result;
    };

  /**
   * Validation Utility to compare Original Spec vs Generated Spec (via Doc)
   */
  export const validateSpecFidelity = (originalContent: string, options: ConversionOptions): { score: number, report: string[] } => {
      try {
          const original = parseContent(originalContent);
          // 1. Generate Doc
          const generatedDoc = convertSpecToDoc(originalContent, options);
          // 2. Parse back to Spec
          const restoredJson = parseHTMLDocToSpec(generatedDoc, { ...options, outputFormat: SpecFormat.JSON });
          const restored = JSON.parse(restoredJson);

          const report: string[] = [];
          let missingCount = 0;

          // Compare Info
          if (original.info?.title !== restored.info?.title) report.push(`Title mismatch: "${original.info.title}" vs "${restored.info.title}"`);
          
          // Compare Servers
          const origServers = original.servers?.length || 0;
          const restServers = restored.servers?.length || 0;
          if (origServers !== restServers) { report.push(`Missing Servers: Expected ${origServers}, got ${restServers}`); missingCount++; }

          // Compare Tags
          const origTags = original.tags?.length || 0;
          const restTags = restored.tags?.length || 0;
          if (origTags !== restTags) { report.push(`Missing Tags: Expected ${origTags}, got ${restTags}`); missingCount++; }

          // Compare Components
          const origComps = Object.keys(original.components?.schemas || {}).length;
          const restComps = Object.keys(restored.components?.schemas || {}).length;
          if (origComps !== restComps) { report.push(`Missing Components: Expected ${origComps}, got ${restComps}`); missingCount += (origComps - restComps); }

          // Deep Compare Paths
          Object.keys(original.paths || {}).forEach(path => {
              if (!restored.paths?.[path]) {
                  report.push(`Missing Path: ${path}`);
                  missingCount++;
              } else {
                  Object.keys(original.paths[path]).forEach(method => {
                      const origOp = original.paths[path][method];
                      const restOp = restored.paths[path][method];
                      if (!restOp) {
                          report.push(`Missing Method: ${method.toUpperCase()} ${path}`);
                          missingCount++;
                      } else {
                          if (origOp.operationId && origOp.operationId !== restOp.operationId) report.push(`OpID Mismatch ${path} ${method}: ${origOp.operationId} vs ${restOp.operationId}`);
                          if ((origOp.security?.length || 0) !== (restOp.security?.length || 0)) report.push(`Security mismatch in ${method.toUpperCase()} ${path}`);
                      }
                  });
              }
          });

          return { score: Math.max(0, 100 - (missingCount * 5)), report };

      } catch (e: any) {
          return { score: 0, report: [`Validation Failed: ${e.message}`] };
      }
  }