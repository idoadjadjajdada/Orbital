/** the light slots every surface shader shares (lights.ts fills them) */
export const NLAMP = 5;
/** the GLSL for the lights: declare the uniforms and `lampLight(P, N)`, the light falling on a point P (camera-relative, m) facing N */
export const LIGHT_GLSL = /* glsl */ `
uniform vec4 lampPos[${NLAMP}];
uniform vec4 lampDir[${NLAMP}];
uniform vec3 lampCol[${NLAMP}];
uniform float lampRange[${NLAMP}];
uniform float ambientX;
vec3 lampLight(vec3 P, vec3 N) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < ${NLAMP}; i++) {
    if (lampPos[i].w <= 0.0) continue;
    vec3 L = lampPos[i].xyz - P;
    float d = length(L);
    L /= max(d, 1e-3);
    float c = dot(-L, lampDir[i].xyz);
    float cone = smoothstep(lampDir[i].w, mix(lampDir[i].w, 1.0, 0.3), c);
    float fall = lampRange[i] > 0.0 ? 1.0 / (1.0 + (d / lampRange[i]) * (d / lampRange[i])) : 1.0;
    s += lampCol[i] * lampPos[i].w * cone * fall * max(dot(N, L), 0.0);
  }
  return s;
}`;

