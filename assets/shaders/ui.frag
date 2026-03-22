#version 330 core

in vec2 TexCoord;
in vec4 Color;

uniform sampler2D uTexture;
uniform bool uUseTexture;

out vec4 FragColor;

void main()
{
    if (uUseTexture)
    {
        FragColor = texture(uTexture, TexCoord) * Color;
    }
    else
    {
        FragColor = Color;
    }
}
