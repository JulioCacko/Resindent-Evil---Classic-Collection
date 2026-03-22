#version 330 core

in vec2 TexCoord;

out vec4 FragColor;

uniform sampler2D uScreenTexture;
uniform float uScanlineIntensity;
uniform float uCurvature;
uniform float uRGBSplit;
uniform float uPhosphorGlow;
uniform float uNoiseAmount;
uniform float uTime;
uniform vec2 uResolution;

float rand(vec2 co)
{
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 barrelDistort(vec2 uv)
{
    vec2 cc = uv - 0.5;
    float r = dot(cc, cc);
    cc = cc * (1.0 + uCurvature * r * 4.0);
    return cc + 0.5;
}

void main()
{
    vec2 uv = barrelDistort(TexCoord);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
    {
        FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec2 dir = normalize(uv - vec2(0.5) + 1e-5) * uRGBSplit;
    float r = texture(uScreenTexture, uv + dir).r;
    float g = texture(uScreenTexture, uv).g;
    float b = texture(uScreenTexture, uv - dir).b;
    vec3 col = vec3(r, g, b);

    vec2 px = vec2(1.0) / max(uResolution, vec2(1.0));
    vec3 blur = (
        texture(uScreenTexture, uv + vec2(px.x, 0.0)).rgb +
        texture(uScreenTexture, uv - vec2(px.x, 0.0)).rgb +
        texture(uScreenTexture, uv + vec2(0.0, px.y)).rgb +
        texture(uScreenTexture, uv - vec2(0.0, px.y)).rgb) * 0.25;
    col += blur * uPhosphorGlow;

    float line = sin(uv.y * uResolution.y * 3.14159265);
    float scan = line * 0.5 + 0.5;
    col *= 1.0 - (1.0 - scan) * uScanlineIntensity;

    float grain = rand(uv * uResolution + uTime) - 0.5;
    col += grain * uNoiseAmount;

    FragColor = vec4(col, 1.0);
}
