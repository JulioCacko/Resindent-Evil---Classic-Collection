#version 330 core

out vec2 TexCoord;

void main()
{
    const vec2 verts[3] = vec2[](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    vec2 v = verts[gl_VertexID];
    gl_Position = vec4(v, 0.0, 1.0);
    TexCoord = v * 0.5 + 0.5;
}
