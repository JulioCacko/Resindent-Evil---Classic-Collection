#version 330 core

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aTexCoord;
layout(location = 2) in vec4 aColor;

uniform mat4 uProjection;

out vec2 TexCoord;
out vec4 Color;

void main()
{
    TexCoord  = aTexCoord;
    Color     = aColor;
    gl_Position = uProjection * vec4(aPos, 1.0);
}
