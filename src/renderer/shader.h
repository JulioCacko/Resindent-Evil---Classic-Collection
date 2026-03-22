#ifndef RE_SHADER_H
#define RE_SHADER_H

#include "core/types.h"

#include <glad/glad.h>

class ShaderProgram
{
public:
    ShaderProgram();
    ~ShaderProgram();

    void Init();
    bool Load(const char* vertPath, const char* fragPath);
    void Bind() const;
    void Unbind() const;

    void SetUniform(const char* name, int value);
    void SetUniform(const char* name, float value);
    void SetUniform(const char* name, float x, float y);
    void SetUniform(const char* name, float x, float y, float z);
    void SetUniform(const char* name, float x, float y, float z, float w);
    void SetUniform(const char* name, const float* mat4);
    void SetUniformBool(const char* name, bool value);

    GLuint Program() const;
    bool IsLoaded() const;
    void Delete();

private:
    GLuint CompileShader(const char* source, GLenum type);
    void CheckErrors(GLuint id, const char* type);

    GLuint programId;
    GLuint vertId;
    GLuint fragId;
    bool loaded;
};

#endif
