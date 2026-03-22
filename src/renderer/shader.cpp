#include <glad/glad.h>

#include "renderer/shader.h"

#include <cstdio>
#include <cstring>
#include <string>

static std::string ReadFile(const char* path)
{
    std::string out;
    FILE* f = std::fopen(path, "rb");
    if(!f)
    {
        std::fprintf(stderr, "ShaderProgram: failed to open file: %s\n", path ? path : "(null)");
        return out;
    }
    if(std::fseek(f, 0, SEEK_END) != 0)
    {
        std::fclose(f);
        return out;
    }
    long sz = std::ftell(f);
    if(sz < 0)
    {
        std::fclose(f);
        return out;
    }
    if(std::fseek(f, 0, SEEK_SET) != 0)
    {
        std::fclose(f);
        return out;
    }
    out.resize(static_cast<size_t>(sz));
    if(sz > 0)
    {
        size_t n = std::fread(&out[0], 1, static_cast<size_t>(sz), f);
        if(n != static_cast<size_t>(sz))
        {
            out.clear();
        }
    }
    std::fclose(f);
    return out;
}

ShaderProgram::ShaderProgram()
    : programId(0)
    , vertId(0)
    , fragId(0)
    , loaded(false)
{
}

ShaderProgram::~ShaderProgram()
{
    Delete();
}

void ShaderProgram::Init()
{
    Delete();
    programId = 0;
    vertId = 0;
    fragId = 0;
    loaded = false;
}

GLuint ShaderProgram::CompileShader(const char* source, GLenum type)
{
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, NULL);
    glCompileShader(shader);
    CheckErrors(shader, "SHADER");
    return shader;
}

void ShaderProgram::CheckErrors(GLuint id, const char* type)
{
    GLint ok = 0;
    if(std::strcmp(type, "PROGRAM") == 0)
    {
        glGetProgramiv(id, GL_LINK_STATUS, &ok);
        if(!ok)
        {
            GLint len = 0;
            glGetProgramiv(id, GL_INFO_LOG_LENGTH, &len);
            if(len > 0)
            {
                std::string log(static_cast<size_t>(len), '\0');
                GLsizei written = 0;
                glGetProgramInfoLog(id, len, &written, &log[0]);
                std::fprintf(stderr, "ShaderProgram link error: %s\n", log.c_str());
            }
            else
            {
                std::fprintf(stderr, "ShaderProgram link error (no log).\n");
            }
        }
    }
    else
    {
        glGetShaderiv(id, GL_COMPILE_STATUS, &ok);
        if(!ok)
        {
            GLint len = 0;
            glGetShaderiv(id, GL_INFO_LOG_LENGTH, &len);
            if(len > 0)
            {
                std::string log(static_cast<size_t>(len), '\0');
                GLsizei written = 0;
                glGetShaderInfoLog(id, len, &written, &log[0]);
                std::fprintf(stderr, "ShaderProgram compile error: %s\n", log.c_str());
            }
            else
            {
                std::fprintf(stderr, "ShaderProgram compile error (no log).\n");
            }
        }
    }
}

bool ShaderProgram::Load(const char* vertPath, const char* fragPath)
{
    Delete();

    std::string vs = ReadFile(vertPath);
    std::string fs = ReadFile(fragPath);
    if(vs.empty() || fs.empty())
    {
        std::fprintf(stderr, "ShaderProgram::Load: empty shader source (%s / %s)\n",
            vertPath ? vertPath : "(null)", fragPath ? fragPath : "(null)");
        return false;
    }

    vertId = CompileShader(vs.c_str(), GL_VERTEX_SHADER);
    fragId = CompileShader(fs.c_str(), GL_FRAGMENT_SHADER);

    GLint vok = 0, fok = 0;
    glGetShaderiv(vertId, GL_COMPILE_STATUS, &vok);
    glGetShaderiv(fragId, GL_COMPILE_STATUS, &fok);
    if(!vok || !fok)
    {
        glDeleteShader(vertId);
        glDeleteShader(fragId);
        vertId = 0;
        fragId = 0;
        return false;
    }

    programId = glCreateProgram();
    glAttachShader(programId, vertId);
    glAttachShader(programId, fragId);
    glLinkProgram(programId);
    CheckErrors(programId, "PROGRAM");

    GLint linked = 0;
    glGetProgramiv(programId, GL_LINK_STATUS, &linked);
    if(!linked)
    {
        glDeleteProgram(programId);
        glDeleteShader(vertId);
        glDeleteShader(fragId);
        programId = 0;
        vertId = 0;
        fragId = 0;
        return false;
    }

    glDetachShader(programId, vertId);
    glDetachShader(programId, fragId);
    glDeleteShader(vertId);
    glDeleteShader(fragId);
    vertId = 0;
    fragId = 0;

    loaded = true;
    return true;
}

void ShaderProgram::Bind() const
{
    glUseProgram(programId);
}

void ShaderProgram::Unbind() const
{
    glUseProgram(0);
}

void ShaderProgram::SetUniform(const char* name, int value)
{
    GLint loc = glGetUniformLocation(programId, name);
    if(loc >= 0)
        glUniform1i(loc, value);
}

void ShaderProgram::SetUniform(const char* name, float value)
{
    GLint loc = glGetUniformLocation(programId, name);
    if(loc >= 0)
        glUniform1f(loc, value);
}

void ShaderProgram::SetUniform(const char* name, float x, float y)
{
    GLint loc = glGetUniformLocation(programId, name);
    if(loc >= 0)
        glUniform2f(loc, x, y);
}

void ShaderProgram::SetUniform(const char* name, float x, float y, float z)
{
    GLint loc = glGetUniformLocation(programId, name);
    if(loc >= 0)
        glUniform3f(loc, x, y, z);
}

void ShaderProgram::SetUniform(const char* name, float x, float y, float z, float w)
{
    GLint loc = glGetUniformLocation(programId, name);
    if(loc >= 0)
        glUniform4f(loc, x, y, z, w);
}

void ShaderProgram::SetUniform(const char* name, const float* mat4)
{
    GLint loc = glGetUniformLocation(programId, name);
    if(loc >= 0)
        glUniformMatrix4fv(loc, 1, GL_FALSE, mat4);
}

void ShaderProgram::SetUniformBool(const char* name, bool value)
{
    SetUniform(name, value ? 1 : 0);
}

GLuint ShaderProgram::Program() const
{
    return programId;
}

bool ShaderProgram::IsLoaded() const
{
    return loaded;
}

void ShaderProgram::Delete()
{
    if(programId != 0)
    {
        glDeleteProgram(programId);
        programId = 0;
    }
    if(vertId != 0)
    {
        glDeleteShader(vertId);
        vertId = 0;
    }
    if(fragId != 0)
    {
        glDeleteShader(fragId);
        fragId = 0;
    }
    loaded = false;
}
